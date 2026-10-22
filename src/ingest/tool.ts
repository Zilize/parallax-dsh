/**
 * Model-facing `parallax_ingest` tool: the harvest controls of the Ingest tab.
 *
 * The agent can read the scope, coverage and job history, start, wait for and
 * cancel a harvest, and save the category scope or proxy. It drives the same
 * IngestService as the browser routes, so a run started here shows up in the
 * Ingest tab's calendar and job list; starting one also publishes
 * `harvest-started`, which opens that tab in the conversation on screen. The
 * Jev API key is the one setting left out: a secret pasted into the
 * conversation would stay in its transcript, so the tool only reports whether
 * a key is configured.
 */

import type { DatabaseSync } from 'node:sqlite'

import { startDshJob, type DshJobRegistry } from '../dsh-jobs.ts'
import { rootSession, TEXT_OUTPUT, type ToolRegistry } from '../host.ts'
import { describeNetwork, updateNetwork, type JevSettings } from '../settings.ts'
import type { FlowEvents } from '../sets/events.ts'
import { normalizeCategories } from '../taxonomy.ts'
import { clampedInt, optionalDate, optionalString, parseAction } from '../tool-args.ts'
import {
  buildCalendar,
  countPapers,
  getCategories,
  getJob,
  latestJob,
  listJobs,
  publishedCompleteness,
  setCategories,
  type CalendarDay,
  type HarvestProgress,
  type JobRecord,
} from './db.ts'
import { MAX_RUN_DAYS, type IngestService, type RunSummary, type StartedRun } from './runner.ts'

const ACTIONS = ['status', 'coverage', 'jobs', 'job', 'harvest', 'wait', 'cancel', 'configure'] as const
const READ_ONLY: ReadonlySet<string> = new Set(['status', 'coverage', 'jobs', 'job', 'wait'])
/** Default coverage window when `from` is omitted. */
const DEFAULT_COVERAGE_DAYS = 30

const today = (): string => new Date().toISOString().slice(0, 10)

function shiftDay(day: string, delta: number): string {
  const cursor = new Date(`${day}T00:00:00Z`)
  cursor.setUTCDate(cursor.getUTCDate() + delta)
  return cursor.toISOString().slice(0, 10)
}

// -- formatting -------------------------------------------------------------

/** The host job's live progress line. */
function progressLine(progress: Readonly<HarvestProgress>): string {
  const parts = [`day ${progress.daysDone + progress.daysSkipped}/${progress.daysTotal}`]
  if (progress.day !== null) parts.push(progress.day)
  parts.push(`${progress.inserted} new`)
  if (progress.retry !== null) parts.push(`retry ${progress.retry.attempt}/${progress.retry.maxAttempts}: ${progress.retry.reason}`)
  return parts.join(' · ')
}

/** One-line result for the completion notice's status line. */
function summaryDetail(summary: RunSummary, record: JobRecord | null): string {
  // A cancel leaves later days untouched, so count what the run recorded as done.
  const harvested = record?.progress.daysDone ?? 0
  const parts = [`${harvested}/${summary.days} days harvested`, `${summary.skipped} skipped`, `${summary.inserted} new`, `${summary.updated} updated`]
  if (summary.failedDays.length > 0) parts.push(`${summary.failedDays.length} failed`)
  return parts.join(', ')
}

function formatJob(job: JobRecord): string {
  const progress = job.progress
  const num = (key: keyof HarvestProgress): number => Number(progress[key] ?? 0)
  const lines = [
    `Job ${job.id} · ${job.status} · ${job.params.from}..${job.params.to} · categories ${job.params.categories.join(', ')}`,
    `  days ${num('daysDone')}/${num('daysTotal')} harvested, ${num('daysSkipped')} skipped (already covered) · records ${num('records')}, matched ${num('matched')}, new ${num('inserted')}, updated ${num('updated')}, removed ${num('removed')}`,
    `  network ${progress.network ?? 'unknown'} · started ${job.startedAt ?? '—'} · finished ${job.finishedAt ?? '—'}`,
  ]
  if (job.status === 'running' && typeof progress.day === 'string') lines.push(`  current day ${progress.day}`)
  const retry = progress.retry
  if (job.status === 'running' && retry !== null && retry !== undefined) {
    lines.push(`  retrying ${retry.attempt}/${retry.maxAttempts}: ${retry.reason}`)
  }
  if (job.lastError !== null) lines.push(`  error: ${job.lastError}`)
  return lines.join('\n')
}

/** Days from..to in one calendar pass per year. */
function calendarRange(db: DatabaseSync, from: string, to: string, categories: readonly string[]): CalendarDay[] {
  const days: CalendarDay[] = []
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    for (const day of buildCalendar(db, year, categories)) {
      if (day.date >= from && day.date <= to) days.push(day)
    }
  }
  return days
}

/** Consecutive days with the same status (and, for partial days, the same gap) become one line. */
function formatCoverage(days: CalendarDay[]): string[] {
  const lines: string[] = []
  let start = 0
  for (let index = 1; index <= days.length; index += 1) {
    const head = days[start]
    const next = days[index]
    const gap = (day: CalendarDay): string => (day.missing ?? []).join(',')
    if (next !== undefined && next.status === head.status && gap(next) === gap(head) && next.status !== 'failed') continue
    const run = days.slice(start, index)
    const range = run.length === 1 ? head.date : `${head.date}..${run[run.length - 1].date}`
    const items = run.reduce((sum, day) => sum + day.items, 0)
    let line = `${range} ${head.status} (${run.length} day${run.length === 1 ? '' : 's'}`
    if (head.status === 'done' || head.status === 'partial') line += `, ${items} records`
    line += ')'
    if (head.status === 'partial') line += ` · missing ${gap(head)}`
    if (head.status === 'failed' && head.lastError !== null) line += ` · ${head.lastError}`
    lines.push(line)
    start = index
  }
  return lines
}

export function registerIngestTool(
  tools: ToolRegistry,
  db: DatabaseSync,
  ingest: IngestService,
  settings: JevSettings,
  events?: FlowEvents,
  /** Looked up per call: the registry may come and go with its plugin. */
  jobs: () => DshJobRegistry | undefined = () => undefined,
): void {
  tools.register({
    name: 'parallax_ingest',
    description: [
      'Control arXiv harvesting into the local Parallax corpus (the Ingest tab). Harvests run by OAI datestamp day (last metadata change, not submission date) over the saved category scope, one run at a time, in the background; the Ingest tab shows the same runs.',
      'action=status: scope, paper count, running job, submission-date completeness, proxy and whether a Jev key is set. action=coverage: per-day coverage for from..to (default the last 30 days). action=jobs: recent runs. action=job: one run (default the latest).',
      `action=harvest: start a run over from..to (≤${MAX_RUN_DAYS} days; days already covered are skipped); categories, when given, replace the saved scope. It is registered as a host background job when available (you are then notified when it ends); action=wait blocks until the run ends (fallback without background jobs). action=cancel stops it.`,
      'action=configure saves categories and/or proxy (HTTP proxy URL; "" clears it). The Jev API key cannot be set here: the user enters it in the Settings tab.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS] },
        from: { type: 'string', description: 'harvest/coverage: first OAI datestamp day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'harvest/coverage: last day, YYYY-MM-DD (coverage defaults to today; harvest requires it).' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'harvest/configure: arXiv codes or group wildcards (cs.CL, stat.ML, cs.*). Saved as the scope; changing it means earlier days count as partial until harvested again.',
        },
        proxy: { type: 'string', description: 'configure: HTTP proxy for harvesting and Jev, e.g. http://127.0.0.1:7890 (host:port alone is accepted; SOCKS is not). "" clears it.' },
        id: { type: 'string', description: 'job/cancel: job id (default the latest / the running one).' },
        limit: { type: 'number', description: 'jobs: how many recent runs, 1–50 (default 10).' },
        timeout_seconds: { type: 'number', description: 'wait: give up after this many seconds (default 300, max 1800).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: args => READ_ONLY.has(String((args as Record<string, unknown> | null)?.action)),
    async execute(args, exec): Promise<string> {
      exec.signal.throwIfAborted()
      const action = parseAction(args.action, ACTIONS)

      if (action === 'status') {
        const categories = getCategories(db)
        const completeness = publishedCompleteness(db, categories)
        const network = describeNetwork(db)
        const jev = await settings.describe()
        const job = latestJob(db)
        const proxy = network.source === 'setting'
          ? `${network.effective} (Settings)`
          : network.source === 'env' ? `${network.effective} (from ${network.envName})` : 'none, direct connection'
        return [
          `Category scope: ${categories.length === 0 ? 'not configured — set it with action=configure or in the Settings tab before harvesting' : categories.join(', ')}.`,
          `Papers stored: ${countPapers(db).toLocaleString('en-US')}.`,
          completeness.since === null
            ? 'Submission-date completeness: none for the current scope.'
            : `Submission-date completeness: ${completeness.since}..${completeness.through}.`,
          `Harvest: ${ingest.busy ? 'running' : 'idle'}.`,
          job === null ? 'Latest job: none.' : `Latest job:\n${formatJob(job)}`,
          `Proxy: ${proxy}.`,
          `Jev API key: ${jev.configured ? `configured (${jev.source ?? 'unknown source'})` : 'not configured — the user adds it in the Settings tab'} · model ${jev.model}.`,
        ].join('\n')
      }

      if (action === 'coverage') {
        const to = optionalDate(args.to, 'to') ?? today()
        const from = optionalDate(args.from, 'from') ?? shiftDay(to, -(DEFAULT_COVERAGE_DAYS - 1))
        if (from > to) throw new Error('from must not be after to')
        if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 3) throw new Error('coverage spans at most four calendar years per call')
        const categories = getCategories(db)
        if (categories.length === 0) return 'No category scope is configured, so no day counts as covered. Set categories first.'
        const days = calendarRange(db, from, to, categories)
        const counts = new Map<string, number>()
        for (const day of days) counts.set(day.status, (counts.get(day.status) ?? 0) + 1)
        return [
          `Coverage ${from}..${to} for ${categories.join(', ')} (OAI datestamp days): ${[...counts].map(([status, n]) => `${status} ${n}`).join(', ')}.`,
          ...formatCoverage(days),
        ].join('\n')
      }

      if (action === 'jobs') {
        const jobs = listJobs(db, clampedInt(args.limit, 'limit', 10, 1, 50))
        return jobs.length === 0 ? 'No harvest runs yet.' : jobs.map(formatJob).join('\n\n')
      }

      if (action === 'job') {
        const id = optionalString(args.id, 'id')
        const job = id === undefined ? latestJob(db) : getJob(db, id)
        if (job === null) return id === undefined ? 'No harvest runs yet.' : `No job ${id}.`
        return formatJob(job)
      }

      if (action === 'harvest') {
        const from = optionalDate(args.from, 'from')
        const to = optionalDate(args.to, 'to')
        if (from === undefined || to === undefined) throw new Error('harvest needs from and to (YYYY-MM-DD)')
        const request = { from, to, categories: args.categories ?? undefined }
        let started: StartedRun | undefined
        // A harvest the model starts is a host job: the header lists it and the
        // owner is notified when it ends. Cancelling it runs our own cancel.
        const dshJob = startDshJob(jobs(), exec, {
          kind: 'parallax-harvest',
          label: `arXiv harvest ${from}..${to}`,
          start: (job) => {
            const run = ingest.start({ ...request, onProgress: (progress) => { job.updateProgress(progressLine(progress)) } })
            started = run
            return {
              cancel: () => { ingest.cancel(run.jobId) },
              done: run.finished.then((summary) => {
                const record = getJob(db, run.jobId)
                return {
                  status: summary.canceled ? 'killed' as const : 'completed' as const,
                  detail: summaryDetail(summary, record),
                  summary: [
                    record === null ? `Harvest ${run.jobId} ended.` : formatJob(record),
                    ...summary.failedDays.length === 0 ? [] : [`Failed days (harvest again to retry): ${summary.failedDays.join(', ')}`],
                    'Run parallax status before relying on the new days.',
                  ].join('\n'),
                }
              }),
            }
          },
        })
        started ??= ingest.start(request)
        // Without a conversation (a bare harness) there is no tab to open; the
        // run has started either way, so this must not throw.
        try {
          const { sessionId } = rootSession(exec.agent)
          events?.publish({ type: 'harvest-started', sessionId, jobId: started.jobId, from: started.from, to: started.to })
        } catch { /* no session */ }
        const network = describeNetwork(db)
        return [
          `Harvest started: job ${started.jobId}, ${started.from}..${started.to} (${started.days} days), categories ${started.categories.join(', ')}, network ${network.effective ?? 'direct'}.`,
          dshJob === undefined
            ? 'Days already covered for this scope are skipped. It runs in the background and shows in the Ingest tab; call action=wait to block until it ends, or action=job to check progress.'
            : `Days already covered for this scope are skipped. It runs as background job ${dshJob}: you are notified in-session when it ends, so keep working on independent steps instead of calling action=wait.`,
        ].join('\n')
      }

      if (action === 'wait') {
        const timeout = clampedInt(args.timeout_seconds, 'timeout_seconds', 300, 1, 1800)
        const finished = await ingest.waitIdle(timeout * 1000, exec.signal)
        const job = latestJob(db)
        const head = finished ? 'No harvest is running.' : `Still harvesting after ${timeout}s; call wait again or continue.`
        return job === null ? head : `${head}\n${formatJob(job)}`
      }

      if (action === 'cancel') {
        const id = optionalString(args.id, 'id')
        if (!ingest.cancel(id)) return id === undefined ? 'No harvest is running.' : `Job ${id} is not running.`
        return 'Cancel requested: the run stops after the current request, and the unfinished day is left failed (harvest it again later).'
      }

      // configure
      if (args.categories === undefined && args.proxy === undefined) throw new Error('configure needs categories and/or proxy')
      const lines: string[] = []
      if (args.categories !== undefined) {
        const categories = normalizeCategories(args.categories)
        setCategories(db, categories)
        lines.push(`Category scope saved: ${categories.join(', ')}. Days harvested under a different scope now count as partial until harvested again.`)
      }
      if (args.proxy !== undefined) {
        const proxy = args.proxy === null ? null : String(args.proxy)
        const view = updateNetwork(db, { proxy })
        lines.push(view.source === 'setting'
          ? `Proxy saved: ${view.effective}. It applies to the next harvest run and Jev request.`
          : `Proxy cleared; ${view.source === 'env' ? `using ${view.effective} from ${view.envName}` : 'connecting directly'}.`)
      }
      return lines.join('\n')
    },
  })
}
