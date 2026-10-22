/**
 * arXiv ingest tab.
 *
 *  - the page reports coverage (read-only calendar) and one Harvest button;
 *  - the dialog only takes the from/to date range. The category scope lives
 *    on the Settings page; until it is set the dialog points there and its
 *    start button stays disabled.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleAlert, Play, RefreshCw, X } from 'lucide-react'
import { cancelJob, ingestFocus, loadJobs, loadState, runRange, type IngestState, type Job } from './ingest-api.ts'
import { JobList } from './job-row.tsx'
import { CalendarGrid, type CalendarView } from './ingest-calendar.tsx'
import { DateField } from './date-field.tsx'
import { errorMessage } from './http.ts'
import { translator, type Translate } from './i18n.ts'

/** Jobs listed under the calendar. */
const JOB_HISTORY = 10
const STATE_POLL_MS = 2000
const JOBS_POLL_MS = 3000

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function today(): string {
  return isoDay(new Date())
}

/** Default range: the last seven days, today inclusive. */
function defaultRange(): { from: string, to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - 6 * 86_400_000)
  return { from: isoDay(from), to: isoDay(to) }
}

export function IngestPane({ sessionId, onOpenSettings, t }: { sessionId?: string, onOpenSettings: () => void, t?: (key: string) => string }): JSX.Element {
  const tr: Translate = translator(t)
  const [year, setYear] = useState<number>(() => ingestFocus.get()?.year ?? new Date().getUTCFullYear())
  const [state, setState] = useState<IngestState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<{ from: string, to: string } | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [view, setView] = useState<CalendarView>('status')

  const refresh = useCallback(async (targetYear: number) => {
    try {
      const next = await loadState(targetYear)
      setState(next)
      setError(null)
      return next
    } catch (cause) {
      setError(errorMessage(cause))
      return null
    }
  }, [])

  useEffect(() => {
    void refresh(year)
  }, [refresh, year])

  const categories = state?.categories ?? []

  const refreshJobs = useCallback(async () => {
    // A transient failure keeps the last list; the next poll retries.
    try { setJobs(await loadJobs(JOB_HISTORY)) } catch { /* transient */ }
  }, [])

  useEffect(() => { void refreshJobs() }, [refreshJobs, state?.job?.status])

  // A harvest the model started: show its year and pick up the running job,
  // which starts the progress polling below.
  useEffect(() => ingestFocus.subscribe(() => {
    const target = ingestFocus.get()?.year
    if (target === undefined) return
    setYear(target)
    void refresh(target)
    void refreshJobs()
  }), [refresh, refreshJobs])

  const running = state?.job?.status === 'running'
  useEffect(() => {
    if (running !== true) return
    const timer = setInterval(() => { void refresh(year) }, STATE_POLL_MS)
    const jobTimer = setInterval(() => { void refreshJobs() }, JOBS_POLL_MS)
    return () => { clearInterval(timer); clearInterval(jobTimer) }
  }, [running, refresh, refreshJobs, year])

  // Settings may have changed the scope since the last poll.
  const openDialog = (): void => {
    setError(null)
    setDialog(defaultRange())
    void refresh(year)
  }

  const goSettings = (): void => {
    setDialog(null)
    onOpenSettings()
  }

  const start = async (): Promise<void> => {
    if (dialog === null) return
    if (categories.length === 0) {
      setError(tr('ingest.pickFirst'))
      return
    }
    if (dialog.from > dialog.to) {
      setError(tr('ingest.badRange'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await runRange(dialog.from, dialog.to)
      setDialog(null)
      await refresh(year)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    setBusy(true)
    try {
      await cancelJob()
      await refresh(year)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  // The live job shows before the next history poll picks it up.
  const shownJobs = useMemo(() => {
    const live = state?.job ?? null
    return live === null || jobs.some(job => job.id === live.id) ? jobs : [live, ...jobs]
  }, [jobs, state?.job])

  const coverage = useMemo(() => {
    if (state === null) return null
    const done = state.calendar.filter(day => day.status === 'done').length
    const partial = state.calendar.filter(day => day.status === 'partial').length
    return { done, partial, total: state.calendar.length }
  }, [state])

  return (
    <div className="pg-root pg-ingest" data-session={sessionId}>
      <div className="pg-col">
        <section className="pg-section">
          <header className="pg-head">
            <h2>{tr('ingest.title')}</h2>
            <div className="pg-head-side">
              <button type="button" className="pg-iconbtn" title={tr('ingest.prevYear')} onClick={() => setYear(value => value - 1)}>
                <ChevronLeft size={15} aria-hidden />
              </button>
              <span className="pg-year">{year}</span>
              <button type="button" className="pg-iconbtn" title={tr('ingest.nextYear')} onClick={() => setYear(value => value + 1)}>
                <ChevronRight size={15} aria-hidden />
              </button>
              <button type="button" className="pg-iconbtn" title={tr('ingest.refresh')} onClick={() => void refresh(year)}>
                <RefreshCw size={14} aria-hidden />
              </button>
              <button type="button" className="pg-btn pg-btn-primary" onClick={openDialog}>
                <Play size={12} aria-hidden /> {tr('ingest.harvest')}
              </button>
            </div>
          </header>
          <p className="pg-meta">
            {tr('ingest.papers', { count: state?.totalPapers ?? 0 })} · {tr('ingest.categoryCount', { count: categories.length })}
            {coverage === null ? '' : ` · ${tr('ingest.coverageDays', { done: coverage.done, total: coverage.total })}`}
          </p>
        </section>

        <section className="pg-section">
          <header className="pg-head">
            <h2>{tr('ingest.coverage', { year })}</h2>
            <div className="pg-seg" role="tablist" aria-label={tr('ingest.coverage', { year })}>
              {(['status', 'count'] as const).map(item => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={view === item}
                  className={view === item ? 'is-active' : ''}
                  onClick={() => setView(item)}
                >
                  {tr(item === 'status' ? 'cal.viewStatus' : 'cal.viewCount')}
                </button>
              ))}
            </div>
          </header>
          {state === null
            ? <p className="pg-meta">{tr('ingest.loading')}</p>
            : <CalendarGrid days={state.calendar} t={t} view={view} />}
        </section>

        <section className="pg-section">
          <header className="pg-head">
            <h2>{tr('ingest.jobs')}</h2>
            <div className="pg-head-side">
              <span className="pg-meta">{tr('ingest.jobsCount', { count: shownJobs.length })}</span>
            </div>
          </header>
          <JobList jobs={shownJobs} tr={tr} busy={busy} onCancel={() => void cancel()} />
        </section>

        {error === null ? null : <p className="pg-error">{error}</p>}
      </div>

      {dialog === null ? null : (
        <div className="pg-overlay" role="presentation" onClick={() => setDialog(null)}>
          <div className="pg-modal pg-harvest" role="dialog" aria-label={tr('ingest.harvestTitle')} onClick={event => event.stopPropagation()}>
            <header className="pg-harvest-head">
              <h3>{tr('ingest.harvestTitle')}</h3>
              <button type="button" className="pg-inspector-close" onClick={() => setDialog(null)}>
                <X size={15} aria-hidden />
              </button>
            </header>

            {categories.length > 0 ? null : (
              <div className="pg-notice" role="status">
                <CircleAlert size={14} aria-hidden />
                <span>{tr('ingest.needCategories')}</span>
                <button type="button" className="pg-notice-link" onClick={goSettings}>{tr('ingest.goSettings')}</button>
              </div>
            )}

            <section className="pg-panel">
              <h4>{tr('ingest.range')}</h4>
              <div className="pg-range">
                <label>
                  <span>{tr('ingest.from')}</span>
                  <DateField
                    value={dialog.from}
                    max={today()}
                    placeholder={tr('ingest.pickDate')}
                    ariaLabel={tr('ingest.from')}
                    onChange={(next) => setDialog(current => current === null ? current : { ...current, from: next })}
                  />
                </label>
                <span className="pg-range-sep" aria-hidden>–</span>
                <label>
                  <span>{tr('ingest.to')}</span>
                  <DateField
                    value={dialog.to}
                    max={today()}
                    placeholder={tr('ingest.pickDate')}
                    ariaLabel={tr('ingest.to')}
                    onChange={(next) => setDialog(current => current === null ? current : { ...current, to: next })}
                  />
                </label>
              </div>
            </section>

            <footer className="pg-harvest-foot">
              <button type="button" className="pg-btn" onClick={() => setDialog(null)}>{tr('ingest.cancel')}</button>
              <button type="button" className="pg-btn pg-btn-primary" onClick={() => void start()} disabled={busy || categories.length === 0}>
                <Play size={12} aria-hidden /> {tr('ingest.start')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
