/**
 * History: the list of set flows, one per conversation that built sets.
 *
 * Each card shows the flow's name with the newest node's operator icon, a
 * fixed three-line preview of its newest sets (name and size), and a footer
 * with the set count and last activity. Sizes come from the host's cache, so
 * listing never re-evaluates a set; a set never evaluated reads as pending.
 */

import { useEffect, useState } from 'react'
import { Layers3 } from 'lucide-react'
import { OP_ICONS } from './graph.tsx'
import { loadFlows, type FlowSummary } from './sets-api.ts'
import { errorMessage, formatCount } from './http.ts'
import { translator, uiLocale, type Translate } from './i18n.ts'

const POLL_MS = 15_000

function relativeTime(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  const format = new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'auto' })
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', Infinity]]
  let value = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit)
    value /= size
  }
  return iso.slice(0, 10)
}

function FlowCard({ flow, current, onOpen, tr }: { flow: FlowSummary, current: boolean, onOpen: (flow: FlowSummary) => void, tr: Translate }): JSX.Element {
  const previews = flow.sets
  const Icon = previews[0] === undefined ? Layers3 : OP_ICONS[previews[0].op]

  return (
    <div className="pg-sf-wrap">
      {/* The whole card opens the flow, by click or by Enter / Space. */}
      <div
        className="pg-sf-card"
        role="button"
        tabIndex={0}
        aria-label={flow.name || tr('history.unnamed')}
        onClick={() => onOpen(flow)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen(flow)
        }}
      >
        <div className="pg-sf-head">
          <div className="pg-sf-title-row">
            <span className="pg-sf-chip" title={previews[0]?.name}>
              <Icon size={16} aria-hidden />
            </span>
            <span className="pg-sf-title">{flow.name || tr('history.unnamed')}</span>
          </div>
          <div className="pg-sf-previews">
            {previews.map(set => (
              <p key={set.code} className="pg-sf-preview">
                <span className="pg-sf-preview-name">{set.name}</span>
                <span className="pg-sf-preview-count">
                  {set.count === null ? tr('history.pending') : tr('history.members', { count: formatCount(set.count) })}
                </span>
              </p>
            ))}
          </div>
        </div>
        <div className="pg-sf-foot">
          <span className="pg-sf-foot-num">{tr('history.sets', { count: flow.setCount })}</span>
          <span aria-hidden className="pg-sf-dot">·</span>
          <span className="pg-sf-foot-time">{relativeTime(flow.updatedAt)}</span>
          {current ? (
            <>
              <span aria-hidden className="pg-sf-dot">·</span>
              <span className="pg-sf-foot-time">{tr('history.current')}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ tr }: { tr: Translate }): JSX.Element {
  return (
    <div className="pg-empty">
      <span className="pg-empty-icon" aria-hidden>
        <Layers3 size={20} />
      </span>
      <p className="pg-empty-title">{tr('history.emptyTitle')}</p>
      <p className="pg-empty-text">{tr('history.empty')}</p>
      <code className="pg-empty-code">/parallax-skills</code>
    </div>
  )
}

export function HistoryPane({ sessionId, onOpenFlow, t }: { sessionId?: string, onOpenFlow: (flow: FlowSummary) => void, t?: (key: string) => string }): JSX.Element {
  const tr = translator(t)
  const [flows, setFlows] = useState<FlowSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    loadFlows()
      .then((next) => { if (alive) { setFlows(next); setError(null) } })
      .catch((reason: unknown) => { if (alive) setError(errorMessage(reason)) })
    const timer = setTimeout(() => { setTick(value => value + 1) }, POLL_MS)
    return () => { alive = false; clearTimeout(timer) }
  }, [tick])

  return (
    <div className="pg-root pg-history" data-session={sessionId}>
      <div className="pg-col">
        <section className="pg-section">
          <header className="pg-head">
            <h2>{tr('history.title')}</h2>
            {flows === null ? null : <span className="pg-meta">{tr('history.count', { count: flows.length })}</span>}
          </header>
          {error === null ? null : <p className="pg-error">{tr('graph.failed', { message: error })}</p>}
          {flows === null && error === null ? <p className="pg-hint">{tr('graph.loading')}</p> : null}
          {flows !== null && flows.length === 0 ? <EmptyState tr={tr} /> : null}
          {flows === null || flows.length === 0 ? null : (
            <div className="pg-sf-grid">
              {flows.map(flow => <FlowCard key={flow.id} flow={flow} current={flow.sessionId === sessionId} onOpen={onOpenFlow} tr={tr} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
