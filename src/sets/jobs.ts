/**
 * Jev judging jobs. One job judges an AI node's undecided candidates; jobs run
 * one at a time, each with a couple of requests in flight. Every answered
 * request is committed at once (decisions + progress in one short
 * transaction), so a failure, cancel or restart keeps what was paid for and
 * the next run only judges what is still undecided.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { errorMessage } from '../host.ts'
import { openNetwork } from '../ingest/network.ts'
import { proxySetting, type JevSettings } from '../settings.ts'
import { Waiters } from '../wait.ts'
import {
  classifyDecisions,
  classifyPayload,
  filterDecisions,
  filterPayload,
  packChunks,
  systemOne,
  type JevRuntime,
  type PaperEvidence,
  type Payload,
  type SystemOneResult,
} from './jev.ts'
import {
  atomically,
  ensureFresh,
  getSet,
  judgedParent,
  latestJobOf,
  undecidedIds,
  writeDecisions,
  type ClassifierParams,
  type Decision,
  type FilterParams,
  type JobView,
  type SetRow,
  type Thresholds,
} from './store.ts'

/**
 * Candidates fetched per planning round at least; a round is packed into
 * requests. Larger settings get larger rounds, so every worker has requests.
 */
const MIN_ROUND = 240
/** One job may judge at most this many papers; narrow the parent first. */
export const MAX_JUDGE_CANDIDATES = 20_000
export const MAX_TRIAL = 40

const now = (): string => new Date().toISOString()

/** A job still pending or running. */
export function isActive(job: JobView): boolean {
  return job.status === 'pending' || job.status === 'running'
}

function evidenceOf(db: DatabaseSync, ids: readonly string[]): Map<string, PaperEvidence> {
  const out = new Map<string, PaperEvidence>()
  const statement = db.prepare('SELECT source_id, title, abstract, authors, published_at, categories FROM papers WHERE source_id = ?')
  for (const id of ids) {
    const row = statement.get(id) as Record<string, string | null> | undefined
    if (row === undefined) continue
    out.set(id, {
      title: row.title ?? '',
      abstract: row.abstract ?? '',
      author: row.authors ?? '',
      published_at: row.published_at ?? '',
      categories: row.categories ?? '',
    })
  }
  return out
}

/** How one judging node turns papers into requests and answers into decisions. */
interface Plan {
  build(papers: readonly PaperEvidence[]): Payload
  decide(ids: readonly string[], result: SystemOneResult): Decision[]
  /** Papers per request when the operator needs a fixed batch (multi-label: one). */
  perRequest?: number
}

function planFor(set: SetRow): Plan {
  if (set.op === 'ai_filter') {
    const params = set.params as unknown as FilterParams
    return {
      build: papers => filterPayload(params.model, params.criteria, papers),
      decide: (ids, result) => filterDecisions(ids, result, params.thresholds),
    }
  }
  if (set.op === 'ai_classifier') {
    const params = set.params as unknown as ClassifierParams
    return {
      build: papers => classifyPayload(params.model, params.categories, params.mode, papers),
      decide: (ids, result) => classifyDecisions(ids, result, params.categories, params.mode, params.thresholds),
      ...params.mode === 'multi_label' ? { perRequest: 1 } : {},
    }
  }
  throw new Error(`set ${set.code} is not a judging node`)
}

/** Run requests for packed chunks with bounded concurrency, handing each answer to `onResult`. */
async function runChunks(
  runtime: JevRuntime,
  plan: Plan,
  chunks: ReadonlyArray<ReadonlyArray<{ id: string, paper: PaperEvidence }>>,
  signal: AbortSignal,
  onResult: (ids: string[], result: SystemOneResult) => void,
): Promise<void> {
  let next = 0
  let failure: unknown
  const worker = async (): Promise<void> => {
    while (failure === undefined && next < chunks.length) {
      const chunk = chunks[next++]
      try {
        const result = await systemOne(runtime, plan.build(chunk.map(item => item.paper)), signal)
        onResult(chunk.map(item => item.id), result)
      } catch (error) {
        failure ??= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(runtime.concurrency, chunks.length) }, worker))
  if (failure !== undefined) throw failure
}

/** Pack papers into requests of at most `plan.perRequest` (or the runtime's batch size) each. */
function packed(db: DatabaseSync, plan: Plan, runtime: JevRuntime, ids: readonly string[]): Array<Array<{ id: string, paper: PaperEvidence }>> {
  const evidence = evidenceOf(db, ids)
  const items = ids.flatMap(id => {
    const paper = evidence.get(id)
    return paper === undefined ? [] : [{ id, paper }]
  })
  return packChunks(items, chunk => plan.build(chunk.map(item => item.paper)), plan.perRequest ?? runtime.batchSize)
}

export interface TrialResult {
  sample: number
  candidates: number
  included: number
  papers: Array<{ sourceId: string, title: string, score: number, include: boolean }>
  requests: number
  inputTokens: number
}

export class JudgeService {
  private active: { jobId: string, setId: string, controller: AbortController } | null = null
  private pumping = false
  private disposed = false
  private readonly waiters = new Waiters()

  constructor(private readonly db: DatabaseSync, private readonly settings: JevSettings) {}

  /** Jobs left pending or running by a stopped process resume where they stopped. */
  recover(): void {
    this.db.prepare("UPDATE judge_jobs SET status = 'pending' WHERE status = 'running'").run()
    void this.pump()
  }

  dispose(): void {
    this.disposed = true
    this.active?.controller.abort(new Error('plugin unloaded'))
    // Trackers settle instead of waiting for a job that only resumes on the next start.
    this.waiters.notify()
  }

  /**
   * Follow the set's current job: `onUpdate` sees each change while it is
   * pending or running, and `done` settles with its final view once it ends —
   * or with the pending view when the plugin unloads first.
   */
  track(setId: string, onUpdate: (job: JobView) => void): { done: Promise<JobView | undefined> } {
    const done = new Promise<JobView | undefined>((resolve) => {
      const check = (): void => {
        const job = latestJobOf(this.db, setId)
        if (job !== undefined && isActive(job) && !this.disposed) {
          try { onUpdate(job) } catch { /* listener failure */ }
          return
        }
        unsubscribe()
        resolve(job)
      }
      const unsubscribe = this.waiters.subscribe(check)
      check()
    })
    return { done }
  }

  /** True while a job for this set is pending or running. */
  busy(setId: string): boolean {
    const job = latestJobOf(this.db, setId)
    return job !== undefined && isActive(job)
  }

  /** Queue a job over the node's undecided candidates. Returns the job, or undefined when nothing is undecided. */
  enqueue(set: SetRow): JobView | undefined {
    if (this.busy(set.id)) return latestJobOf(this.db, set.id)
    const undecided = undecidedIds(this.db, set).length
    if (undecided === 0) return undefined
    if (undecided > MAX_JUDGE_CANDIDATES) {
      throw new Error(`${undecided.toLocaleString('en-US')} papers are undecided; one Jev run judges at most ${MAX_JUDGE_CANDIDATES.toLocaleString('en-US')}. Narrow the parent first`)
    }
    this.db.prepare("INSERT INTO judge_jobs (id, set_id, status, total, created_at) VALUES (?, ?, 'pending', ?, ?)")
      .run(randomUUID(), set.id, undecided, now())
    this.waiters.notify()
    void this.pump()
    return latestJobOf(this.db, set.id)
  }

  /** Cancel the set's pending or running job; decisions already written stay. */
  cancel(setId: string): boolean {
    const job = latestJobOf(this.db, setId)
    if (job === undefined || !isActive(job)) return false
    if (this.active?.jobId === job.id) {
      this.active.controller.abort(new Error('canceled'))
    } else {
      this.finish(job.id, 'canceled', null)
    }
    return true
  }

  /** Resolve true once none of the sets has an active job, false on timeout or abort. */
  async waitFor(setIds: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return await this.waiters.until(() => setIds.every(id => !this.busy(id)), timeoutMs, signal)
  }

  /** Judge a small even sample of a parent without storing anything (calibration). */
  async trial(parent: SetRow, criteria: string, sampleSize: number, model: string, thresholds: Thresholds, signal?: AbortSignal): Promise<TrialResult> {
    await this.requireRuntime()
    const candidates = ensureFresh(this.db, parent).count
    if (candidates === 0) throw new Error(`set ${parent.code} is empty`)
    const size = Math.min(Math.max(1, Math.trunc(sampleSize)), MAX_TRIAL, candidates)
    const step = candidates / size
    const positions = Array.from({ length: size }, (_, index) => Math.floor(index * step))
    const pick = this.db.prepare('SELECT source_id AS id FROM set_members WHERE set_id = ? AND position = ?')
    const ids = positions.map(position => (pick.get(parent.id, position) as { id: string }).id)
    const plan = planFor({ ...parent, op: 'ai_filter', params: { criteria, model, thresholds } })
    const titles = new Map([...evidenceOf(this.db, ids)].map(([id, paper]) => [id, paper.title]))
    const result: TrialResult = { sample: ids.length, candidates, included: 0, papers: [], requests: 0, inputTokens: 0 }
    await this.connected(runtime => runChunks(runtime, plan, packed(this.db, plan, runtime, ids), signal ?? new AbortController().signal, (chunkIds, response) => {
      result.requests += 1
      result.inputTokens += response.inputTokens
      for (const decision of plan.decide(chunkIds, response)) {
        const include = decision.outcome === 'include'
        if (include) result.included += 1
        result.papers.push({ sourceId: decision.sourceId, title: titles.get(decision.sourceId) ?? '', score: decision.score ?? 0, include })
      }
    }))
    result.papers.sort((a, b) => b.score - a.score)
    return result
  }

  async requireRuntime(): Promise<JevRuntime> {
    const runtime = await this.settings.runtime()
    if (runtime === undefined) {
      throw new Error('Jev is not configured: the user must add a Jev API key in the Parallax settings tab before AI screening or classification can run')
    }
    return runtime
  }

  /** Run with the runtime routed through the Settings proxy, read per run so a saved proxy reaches the next one. */
  private async connected<T>(use: (runtime: JevRuntime) => Promise<T>): Promise<T> {
    const runtime = await this.requireRuntime()
    const network = openNetwork(proxySetting(this.db))
    try {
      return await use({ ...runtime, dispatcher: network.dispatcher })
    } finally {
      await network.close()
    }
  }

  private finish(jobId: string, status: 'done' | 'failed' | 'canceled', error: string | null): void {
    this.db.prepare('UPDATE judge_jobs SET status = ?, last_error = ?, finished_at = ? WHERE id = ?')
      .run(status, error === null ? null : error.slice(0, 2000), now(), jobId)
    this.waiters.notify()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (!this.disposed) {
        const row = this.db.prepare("SELECT id, set_id FROM judge_jobs WHERE status = 'pending' ORDER BY created_at, rowid LIMIT 1")
          .get() as { id: string, set_id: string } | undefined
        if (row === undefined) return
        await this.run(row.id, row.set_id)
      }
    } finally {
      this.pumping = false
    }
  }

  private async run(jobId: string, setId: string): Promise<void> {
    const controller = new AbortController()
    this.active = { jobId, setId, controller }
    this.db.prepare("UPDATE judge_jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?").run(now(), jobId)
    this.waiters.notify()
    try {
      const set = getSet(this.db, setId)
      if (set === undefined) throw new Error('the judged set no longer exists')
      const plan = planFor(set)
      await this.connected(async (runtime) => {
        for (;;) {
          controller.signal.throwIfAborted()
          const round = Math.max(MIN_ROUND, runtime.concurrency * (plan.perRequest ?? runtime.batchSize) * 2)
          const ids = undecidedIds(this.db, set, round)
          if (ids.length === 0) break
          const chunks = packed(this.db, plan, runtime, ids)
          if (chunks.length === 0) break
          await runChunks(runtime, plan, chunks, controller.signal, (chunkIds, result) => {
            atomically(this.db, () => {
              writeDecisions(this.db, set.id, plan.decide(chunkIds, result))
              this.db.prepare(`
                UPDATE judge_jobs SET judged = judged + ?, requests = requests + 1,
                  input_tokens = input_tokens + ?, output_tokens = output_tokens + ?
                WHERE id = ?
              `).run(chunkIds.length, result.inputTokens, result.outputTokens, jobId)
            })
            this.waiters.notify()
          })
          // The parent may have grown while judging; keep the total honest.
          const remaining = undecidedIds(this.db, set).length
          this.db.prepare('UPDATE judge_jobs SET total = judged + ? WHERE id = ?').run(remaining, jobId)
        }
      })
      this.finish(jobId, 'done', null)
    } catch (error) {
      if (this.disposed) {
        // Unloading is not a user cancel: the next start resumes this job.
        try { this.db.prepare("UPDATE judge_jobs SET status = 'pending' WHERE id = ?").run(jobId) } catch { /* database closed */ }
        return
      }
      this.finish(jobId, controller.signal.aborted ? 'canceled' : 'failed', controller.signal.aborted ? null : errorMessage(error))
    } finally {
      this.active = null
    }
  }
}

/** The judging node behind a node: itself, or a classification output's classifier. */
export function judgingNode(db: DatabaseSync, set: SetRow): SetRow | undefined {
  if (set.op === 'ai_filter' || set.op === 'ai_classifier') return set
  if (set.op === 'classification_output') return judgedParent(db, set)
  return undefined
}
