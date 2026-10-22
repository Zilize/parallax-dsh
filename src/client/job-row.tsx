/**
 * Harvest job history: range, day and record counts, retry state and error
 * of each run, newest first.
 */

import { Inbox, Square } from 'lucide-react'
import type { Job } from './ingest-api.ts'
import { uiLocale, type LocaleKey, type Translate } from './i18n.ts'

const STATUS_LABEL: Record<Job['status'], LocaleKey> = {
  running: 'ingest.status.running',
  done: 'ingest.status.done',
  failed: 'ingest.status.failed',
  canceled: 'ingest.status.canceled',
}

function stamp(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(uiLocale(), {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function JobList({
  jobs,
  tr,
  onCancel,
  busy,
}: {
  jobs: Job[]
  tr: Translate
  onCancel: () => void
  busy: boolean
}): JSX.Element {
  if (jobs.length === 0) {
    return (
      <div className="pg-jobs-empty">
        <Inbox size={18} aria-hidden />
        <span>{tr('ingest.jobsEmpty')}</span>
      </div>
    )
  }

  return (
    <ul className="pg-jobs">
      {jobs.map((job) => {
        const progress = job.progress
        const running = job.status === 'running'
        return (
          <li key={job.id} className="pg-job">
            <span className={`pg-job-dot is-${job.status}`} aria-hidden />
            <div className="pg-job-main">
              <div className="pg-job-title">
                <span>{job.params.from} → {job.params.to}</span>
                <span className="pg-job-days">{tr('ingest.jobDays', { count: progress.daysTotal ?? 0 })}</span>
              </div>
              <div className="pg-job-meta">
                <span>{tr(STATUS_LABEL[job.status])}</span>
                <span className="pg-job-sep" aria-hidden>·</span>
                <span>{tr('ingest.jobRecords', { count: (progress.inserted ?? 0) + (progress.updated ?? 0) })}</span>
              </div>
              {running && progress.retry != null ? (
                <p className="pg-job-error">
                  {tr('ingest.retry', {
                    attempt: progress.retry.attempt,
                    max: progress.retry.maxAttempts,
                    reason: progress.retry.reason === 'timeout' ? tr('ingest.retryTimeout') : progress.retry.reason,
                    network: progress.network === undefined || progress.network === 'direct' ? tr('ingest.direct') : progress.network,
                  })}
                </p>
              ) : null}
              {job.lastError !== null && job.status !== 'done' && job.status !== 'running' ? (
                <p className="pg-job-error">{job.lastError}</p>
              ) : null}
            </div>
            <div className="pg-job-side">
              <span className="pg-job-time">{stamp(job.createdAt)}</span>
              {running ? (
                <button type="button" className="pg-btn pg-btn-quiet" disabled={busy} onClick={onCancel}>
                  <Square size={11} aria-hidden /> {tr('ingest.cancel')}
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
