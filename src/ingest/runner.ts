/**
 * Manual harvest runner. One job at a time, day by day; a re-run skips the
 * categories each day already holds, so a widened scope only fetches what is
 * new.
 *
 * Every day's coverage goes `running → done | failed` with its created and
 * updated counts. An abort leaves the day `failed` (never a false green) and
 * the job `canceled`. Days are OAI datestamp days (last metadata change), not
 * submission days — see `publishedCompleteness`.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'

import { errorMessage } from '../host.ts'
import { proxySetting } from '../settings.ts'
import { expandCategories, matchesCategories, normalizeCategories, oaiSetsFor } from '../taxonomy.ts'
import { Waiters } from '../wait.ts'
import { DEFAULT_REQUEST_DELAY_MS, harvestDayPages, type HarvestPage } from './arxiv.ts'
import {
  bumpLibraryVersion,
  coveredCategoriesForDay,
  createJob,
  finishJob,
  getCategories,
  latestJob,
  markCoverageDone,
  markCoverageFailed,
  markCoverageRunning,
  removePaper,
  setCategories,
  updateJobProgress,
  upsertPaper,
  type HarvestProgress,
  type JobRecord,
} from './db.ts'
import { openNetwork, type OutboundNetwork } from './network.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
/** Longest range one run accepts. */
export const MAX_RUN_DAYS = 366

export interface StartRequest {
  from?: unknown
  to?: unknown
  /** Omitted: the saved scope. Given: validated, then saved as the new scope. */
  categories?: unknown
  /** Called with the job's progress every time it is saved. */
  onProgress?: (progress: Readonly<HarvestProgress>) => void
}

export interface RunSummary {
  jobId: string
  days: number
  skipped: number
  records: number
  matched: number
  inserted: number
  updated: number
  /** Stored papers dropped because the repository reported them deleted. */
  removed: number
  failedDays: string[]
  canceled: boolean
}

export interface StartedRun {
  jobId: string
  from: string
  to: string
  days: number
  categories: string[]
  /** Settles when the run ends; rejects only when the run itself crashed. */
  finished: Promise<RunSummary>
}

interface RunPlan {
  jobId: string
  days: string[]
  categories: string[]
  requestDelayMs: number
  onProgress?: StartRequest['onProgress']
}

/** State one run shares with its days. */
interface RunState {
  plan: RunPlan
  signal: AbortSignal
  network: OutboundNetwork
  summary: RunSummary
  progress: HarvestProgress
  publish: () => void
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export class IngestService {
  private running: { id: string, controller: AbortController } | null = null
  private readonly waiters = new Waiters()

  constructor(private readonly db: DatabaseSync) {}

  /** True while a harvest is in flight in this process. */
  get busy(): boolean {
    return this.running !== null
  }

  latest(): JobRecord | null {
    return latestJob(this.db)
  }

  /** Stop the running job (or only job `id`); false when nothing matched. */
  cancel(id?: string): boolean {
    if (this.running === null) return false
    if (id !== undefined && this.running.id !== id) return false
    this.running.controller.abort()
    return true
  }

  /** Resolve true once no harvest is running, false on timeout or abort. */
  async waitIdle(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return await this.waiters.until(() => !this.busy, timeoutMs, signal)
  }

  /**
   * Validate a harvest request, save its scope and start it in the background.
   * Shared by the ingest route and the model's `parallax_ingest` tool; throws
   * with a user-facing message on a bad request.
   */
  start(request: StartRequest): StartedRun {
    if (this.busy) throw new Error('a harvest is already running')
    const from = String(request.from ?? '')
    const to = String(request.to ?? '')
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new Error('dates must be YYYY-MM-DD')
    // No built-in default scope: the user picks categories in Settings first.
    const categories = request.categories === undefined ? getCategories(this.db) : normalizeCategories(request.categories)
    if (categories.length === 0) throw new Error('no category scope is configured yet; choose categories in Settings first')
    const count = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
    if (!Number.isFinite(count) || count < 1) throw new Error('the start date must not be after the end date')
    if (count > MAX_RUN_DAYS) throw new Error(`one run covers at most ${MAX_RUN_DAYS} days`)

    setCategories(this.db, categories)
    const jobId = randomUUID()
    const finished = this.run({
      jobId,
      days: daysBetween(from, to),
      categories,
      requestDelayMs: Number(process.env.PARALLAX_OAI_DELAY_MS ?? DEFAULT_REQUEST_DELAY_MS),
      ...request.onProgress === undefined ? {} : { onProgress: request.onProgress },
    })
    finished.catch((error: unknown) => { console.error('[parallax] harvest failed:', error) })
    return { jobId, from, to, days: count, categories, finished }
  }

  /** Harvest every day of the plan. Registers the job before its first await. */
  private async run(plan: RunPlan): Promise<RunSummary> {
    const controller = new AbortController()
    this.running = { id: plan.jobId, controller }
    createJob(this.db, plan.jobId, { from: plan.days[0], to: plan.days[plan.days.length - 1], categories: plan.categories })
    // Read per job, so a proxy saved in Settings reaches the next run.
    const network = openNetwork(proxySetting(this.db))
    const summary: RunSummary = {
      jobId: plan.jobId,
      days: plan.days.length,
      skipped: 0,
      records: 0,
      matched: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
      failedDays: [],
      canceled: false,
    }
    const progress: HarvestProgress = {
      network: network.label,
      retry: null,
      day: null,
      daysTotal: plan.days.length,
      daysDone: 0,
      daysSkipped: 0,
      records: 0,
      matched: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
    }
    const publish = (): void => {
      updateJobProgress(this.db, plan.jobId, progress)
      // A listener (the host job's progress line) must never break the run.
      try { plan.onProgress?.(progress) } catch { /* listener failure */ }
    }
    const state: RunState = { plan, signal: controller.signal, network, summary, progress, publish }
    publish()

    try {
      const requested = expandCategories(plan.categories)
      let harvested = false
      for (const day of plan.days) {
        if (controller.signal.aborted) break
        // Only harvest what the day is still missing: a widened scope after a
        // narrower run must fetch the new categories, not replay the old ones.
        const covered = coveredCategoriesForDay(this.db, day)
        const needed = requested.filter(code => !covered.has(code))
        if (needed.length === 0) {
          summary.skipped += 1
          progress.daysSkipped = summary.skipped
          publish()
          continue
        }
        // Keep arXiv's request spacing across days too.
        if (harvested && plan.requestDelayMs > 0) await sleep(plan.requestDelayMs)
        if (controller.signal.aborted) break
        await this.harvestDay(day, needed, state)
        harvested = true
      }
      summary.canceled = controller.signal.aborted
      finishJob(this.db, plan.jobId, summary.canceled ? 'canceled' : 'done', summary.canceled ? 'canceled by the user' : null)
      return summary
    } catch (error) {
      finishJob(this.db, plan.jobId, 'failed', errorMessage(error))
      throw error
    } finally {
      this.running = null
      this.waiters.notify()
      await network.close()
    }
  }

  /** Harvest one day for the categories it still lacks. A failed day is recorded, never thrown. */
  private async harvestDay(day: string, needed: string[], state: RunState): Promise<void> {
    const { summary, progress, publish, signal } = state
    progress.day = day
    publish()
    markCoverageRunning(this.db, day, needed)

    const counts = { created: 0, updated: 0 }
    const seen = new Set<string>()
    try {
      for await (const page of harvestDayPages(day, {
        sets: oaiSetsFor(needed),
        signal,
        requestDelayMs: state.plan.requestDelayMs,
        dispatcher: state.network.dispatcher,
        onRetry: (retry) => {
          progress.retry = { ...retry, at: new Date().toISOString() }
          publish()
        },
      })) {
        this.storePage(page, needed, seen, counts, summary)
        progress.pages = page.page
        progress.retry = null
        progress.records = summary.records
        progress.matched = summary.matched
        progress.inserted = summary.inserted + counts.created
        progress.updated = summary.updated + counts.updated
        progress.removed = summary.removed
        publish()
      }
      markCoverageDone(this.db, day, needed, counts.created, counts.updated)
      progress.daysDone += 1
    } catch (error) {
      const message = signal.aborted
        ? 'harvest canceled before this day finished'
        : `harvest failed: ${errorMessage(error)} (network: ${state.network.label})`
      progress.retry = null
      markCoverageFailed(this.db, day, needed, message)
      summary.failedDays.push(day)
      // A single bad day must not abort the rest of the range.
    } finally {
      // Pages committed before a failure are in the corpus; count them.
      summary.inserted += counts.created
      summary.updated += counts.updated
      progress.inserted = summary.inserted
      progress.updated = summary.updated
      publish()
    }
  }

  /**
   * Commit one page in one short transaction with no await inside: the plugin
   * shares this connection with its routes, and a transaction held across
   * network waits would swallow (and on rollback lose) their writes. Committed
   * pages survive a later failure; upserts are idempotent and the day stays
   * `failed` until a full re-run.
   */
  private storePage(page: HarvestPage, needed: readonly string[], seen: Set<string>, counts: { created: number, updated: number }, summary: RunSummary): void {
    this.db.exec('BEGIN')
    try {
      const before = counts.created + counts.updated + summary.removed
      for (const record of page.records) {
        // A paper cross-listed across two requested sets arrives twice; store it once.
        if (seen.has(record.sourceId)) continue
        seen.add(record.sourceId)
        summary.records += 1
        if (!matchesCategories(record.categories, needed)) continue
        summary.matched += 1
        if (upsertPaper(this.db, record, new Date().toISOString()) === 'inserted') counts.created += 1
        else counts.updated += 1
      }
      for (const sourceId of page.deleted) {
        if (removePaper(this.db, sourceId)) summary.removed += 1
      }
      // Sets reading the corpus re-evaluate on their next read.
      if (counts.created + counts.updated + summary.removed > before) bumpLibraryVersion(this.db)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* no transaction left */ }
      throw error
    }
  }
}
