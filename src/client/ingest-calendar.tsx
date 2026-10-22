/**
 * Year coverage calendar — read-only.
 *
 * The harvest range is picked in the Harvest dialog, so this grid only
 * reports each day's state: a status colour, a today ring, and a hover tip
 * with the date, status and counts.
 */

import { useMemo } from 'react'
import { translator, type LocaleKey, type Translate } from './i18n.ts'
import { TipLayer, useTip } from './hover-tip.tsx'
import type { CalendarDay, DayStatus } from './ingest-api.ts'

const WEEKDAY_KEYS: LocaleKey[] = [
  'cal.wd.sun', 'cal.wd.mon', 'cal.wd.tue', 'cal.wd.wed', 'cal.wd.thu', 'cal.wd.fri', 'cal.wd.sat',
]

const STATUS_LABEL: Record<DayStatus, LocaleKey> = {
  done: 'cal.done',
  running: 'cal.running',
  failed: 'cal.failed',
  missing: 'cal.missing',
  partial: 'cal.partial',
}

const STATUS_CLASS: Record<DayStatus, string> = {
  done: 'is-done',
  running: 'is-running',
  failed: 'is-failed',
  missing: 'is-missing',
  partial: 'is-partial',
}

/** One legend entry: dot + label + tabular value that pops only when non-zero. */
function Legend({ tone, label, count }: { tone: string, label: string, count: number }): JSX.Element {
  return (
    <span className="pg-legend">
      <i className={`pg-dot-legend is-${tone}`} />
      <span>{label}</span>
      <span className={count > 0 ? 'pg-legend-value' : 'pg-legend-zero'}>{count}</span>
    </span>
  )
}

export type CalendarView = 'status' | 'count'

export function CalendarGrid({
  days,
  t,
  view = 'status',
}: {
  days: CalendarDay[]
  t?: (key: string) => string
  /** status: colour by state; count: OAI records seen that harvest day. */
  view?: CalendarView
}): JSX.Element {
  const tr: Translate = translator(t)
  const { tip, bind } = useTip()
  const months = useMemo(() => {
    const byMonth = new Map<number, CalendarDay[]>()
    for (const day of days) {
      const month = Number(day.date.slice(5, 7)) - 1
      const list = byMonth.get(month)
      if (list === undefined) byMonth.set(month, [day])
      else list.push(day)
    }
    return Array.from({ length: 12 }, (_, month) => byMonth.get(month) ?? [])
  }, [days])

  const today = new Date().toISOString().slice(0, 10)

  const stats = useMemo(() => {
    const count = (status: DayStatus): number => days.filter(day => day.status === status).length
    return {
      done: count('done'),
      running: count('running'),
      partial: count('partial'),
      missing: count('missing'),
      failed: count('failed'),
    }
  }, [days])

  return (
    <>
      {view === 'count' ? (
        <p className="pg-hint">{tr('cal.countHint', { total: days.reduce((sum, day) => sum + (day.items ?? 0), 0) })}</p>
      ) : null}

      {view === 'status' ? <div className="pg-cal-legend">
        <Legend tone="done" label={tr('cal.done')} count={stats.done} />
        {stats.running > 0 ? <Legend tone="running" label={tr('cal.running')} count={stats.running} /> : null}
        <Legend tone="partial" label={tr('cal.partial')} count={stats.partial} />
        <Legend tone="missing" label={tr('cal.missing')} count={stats.missing} />
        <Legend tone="failed" label={tr('cal.failed')} count={stats.failed} />
      </div> : null}

      <div className="pg-cal-months">
        {months.map((monthDays, month) => {
          const leading = monthDays.length > 0 ? new Date(`${monthDays[0].date}T00:00:00Z`).getUTCDay() : 0
          return (
            <div className="pg-cal-month" key={month}>
              <div className="pg-cal-month-title">
                {month + 1}
                {view === 'count'
                  ? <span className="pg-cal-month-sum"> · {monthDays.reduce((sum, day) => sum + (day.items ?? 0), 0)}</span>
                  : null}
              </div>
              <div className="pg-cal-weekdays">
                {WEEKDAY_KEYS.map(key => <div key={key}>{tr(key)}</div>)}
              </div>
              <div className="pg-cal-grid">
                {Array.from({ length: leading }, (_, index) => <div key={`blank-${index}`} className="pg-cal-blank" />)}
                {monthDays.map((day) => {
                  const dayNumber = Number(day.date.slice(8, 10))
                  const missing = day.missing ?? []
                  const title = `${day.date} · ${tr(STATUS_LABEL[day.status])}`
                    + `${day.items === undefined ? '' : ` · ${tr('cal.items', { count: day.items })}`}`
                    + `${missing.length === 0 ? '' : ` · ${tr('cal.missingCategories', { list: missing.join(', ') })}`}`
                  return (
                    <div
                      key={day.date}
                      className={['pg-cal-day', STATUS_CLASS[day.status], view === 'status' ? '' : 'is-count', day.date === today ? 'is-today' : ''].filter(Boolean).join(' ')}
                      {...bind(title)}
                    >
                      {view === 'count' ? (day.items ?? 0) : dayNumber}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <TipLayer tip={tip} />
    </>
  )
}
