/**
 * The canvas tab: build graph on top, the selected node's papers below.
 *
 * The graph is the flow picked in History or started by the model (the only
 * ways in, so a graph with no sets means something is broken, not a normal
 * empty state). It polls while Jev is judging and slowly otherwise; the model
 * builds the graph, the pane only reads it. Hovering a card reveals an info
 * button that opens the node's detail dialog, whose action is a JSON export.
 *
 * The expanded graph is a dialog: it opens centred on the selected card and
 * keeps node details in a column beside the graph instead of stacking a
 * second dialog — a card click there selects and inspects at once. Only one
 * canvas is mounted at a time (the inline one leaves an equal-height
 * placeholder), and closing hands the dialog's camera back to the inline
 * graph and takes the details with it.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Viewport } from '@xyflow/react'
import { Maximize2, X } from 'lucide-react'
import { BuildGraph, nodeState } from './graph.tsx'
import { MemberList } from './papers.tsx'
import { BackendChip, ClassifierBackLink, ClassifierOutputs, FilterResults, ProbabilityToggle, UndecidedBanner, classificationState } from './judgment.tsx'
import { NodeDetail } from './node-detail.tsx'
import { loadFlow, viewedFlow, type FlowGraph } from './sets-api.ts'
import { errorMessage, formatCount } from './http.ts'
import { translator } from './i18n.ts'

const POLL_BUSY_MS = 3000
const POLL_IDLE_MS = 10_000
/** The detail column fades over 200ms; unmount one frame later so the last frame is not cut. */
const PANE_FADE_MS = 220

/** Keep a value mounted for `ms` after it goes null, for an exit animation. */
function useLingering<T>(value: T | null, ms: number): { shown: T | null, closing: boolean } {
  const [last, setLast] = useState<T | null>(value)
  useEffect(() => {
    if (value !== null) { setLast(value); return }
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => { setLast(null) }, reduce ? 0 : ms)
    return () => { clearTimeout(timer) }
  }, [value, ms])
  return { shown: value ?? last, closing: value === null && last !== null }
}

export function ParallaxPane({ sessionId, t }: { sessionId?: string, t?: (key: string) => string }): JSX.Element {
  const tr = translator(t)
  const viewed = useSyncExternalStore(viewedFlow.subscribe, viewedFlow.get)
  const [graph, setGraph] = useState<FlowGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  // Snapshot of the selection when the dialog opened: the camera centres there once.
  const [expandedFocus, setExpandedFocus] = useState<string | null>(null)
  const [dialogViewport, setDialogViewport] = useState<Viewport | null>(null)
  const [handoffViewport, setHandoffViewport] = useState<Viewport | null>(null)
  const clearHandoff = useCallback(() => { setHandoffViewport(null) }, [])
  // One detail slot: a column inside the expanded dialog, a modal otherwise.
  const [detailCode, setDetailCode] = useState<string | null>(null)
  // The probability view belongs to the output node that turned it on: any
  // other selection starts again from the plain list.
  const [probabilitiesFor, setProbabilitiesFor] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => { setTick(value => value + 1) }, [])
  const target = useMemo(() => viewed !== null ? { flowId: viewed } : { sessionId: sessionId ?? '' }, [viewed, sessionId])

  useEffect(() => {
    let alive = true
    loadFlow(target)
      .then((next) => { if (alive) { setGraph(next); setError(null) } })
      .catch((reason: unknown) => { if (alive) setError(errorMessage(reason)) })
    return () => { alive = false }
  }, [target, tick])

  const nodes = graph?.nodes ?? []
  const busy = nodes.some(node => nodeState(node) === 'running')
  useEffect(() => {
    const timer = setTimeout(refresh, busy ? POLL_BUSY_MS : POLL_IDLE_MS)
    return () => { clearTimeout(timer) }
  }, [graph, busy, refresh])

  // Keep a valid selection: the newest node by default, as the model just made it.
  useEffect(() => {
    if (nodes.length === 0) { setSelectedCode(null); return }
    if (selectedCode === null || !nodes.some(node => node.code === selectedCode)) setSelectedCode(nodes[nodes.length - 1].code)
  }, [nodes, selectedCode])

  const selected = nodes.find(node => node.code === selectedCode) ?? null
  // Classification judgements carry category keys; name them from the classifier.
  const classifier = selected?.op === 'classification_output' ? nodes.find(node => node.code === selected.parents[0]?.code) : selected
  const labelNames = useMemo(() => new Map((classifier?.classes ?? []).map(item => [item.key, item.name])), [classifier])
  const output = selected?.op === 'classification_output'
  const probabilities = output && probabilitiesFor === selected.code
  const outputState = output && classifier !== undefined && classifier !== null ? classificationState(classifier) : 'done'
  const revision = selected === null ? '' : `${selected.count}:${selected.judged ?? ''}:${selected.job?.status ?? ''}:${classifier?.judged ?? ''}`
  const detail = detailCode === null ? null : nodes.find(node => node.code === detailCode) ?? null
  const inspect = useCallback((code: string) => { setSelectedCode(code); setDetailCode(code) }, [])
  const paneDetail = useLingering(expanded ? detail : null, PANE_FADE_MS)
  const openExpanded = (): void => {
    setExpandedFocus(selectedCode)
    setDialogViewport(null)
    setExpanded(true)
  }
  const closeExpanded = useCallback((): void => {
    setExpanded(false)
    setHandoffViewport(dialogViewport)
    // The details belong to the big graph: closing must not drop them onto the inline modal.
    setDetailCode(null)
  }, [dialogViewport])

  useEffect(() => {
    if (!expanded && detail === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (expanded) closeExpanded()
      else setDetailCode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [expanded, detail, closeExpanded])
  const foreign = viewed !== null && graph?.flow?.sessionId !== sessionId

  return (
    <div className="pg-root" data-session={sessionId}>
      <div className="pg-col">
        {selected === null ? null : <UndecidedBanner node={selected} t={t} />}
        <section className="pg-section">
          <header className="pg-head">
            <h2>{graph?.flow?.name || tr('graph.title')}</h2>
            <div className="pg-head-side">
              {nodes.length === 0 ? null : (
                <button type="button" className="pg-iconbtn" title={tr('graph.expand')} aria-label={tr('graph.expand')} onClick={openExpanded}>
                  <Maximize2 size={15} aria-hidden />
                </button>
              )}
            </div>
          </header>
          {foreign ? <p className="pg-hint">{tr('graph.viewing')}</p> : null}
          {error === null ? null : <p className="pg-error">{tr('graph.failed', { message: error })}</p>}
          {graph === null && error === null ? <p className="pg-hint">{tr('graph.loading')}</p> : null}
          {graph !== null && nodes.length === 0 ? <p className="pg-error">{tr('graph.empty')}</p> : null}
          {nodes.length === 0 ? null : expanded ? (
            <div className="pg-canvas pg-canvas--placeholder" aria-hidden />
          ) : (
            <BuildGraph
              nodes={nodes}
              selectedCode={selectedCode}
              onSelect={setSelectedCode}
              onInspect={inspect}
              initialViewport={handoffViewport}
              onInitialViewportApplied={clearHandoff}
              zoomOnScroll
              t={t}
            />
          )}
          {graph !== null && !graph.jevConfigured ? <p className="pg-hint">{tr('graph.jevMissing')}</p> : null}
        </section>

        {selected === null ? null : (
          <section className="pg-section pg-section--members">
            <ClassifierBackLink node={selected} nodes={nodes} onSelect={setSelectedCode} t={t} />
            <header className="pg-head">
              <h2>{selected.name}</h2>
              <div className="pg-head-side">
                {output ? (
                  <>
                    <BackendChip tr={tr} />
                    <ProbabilityToggle checked={probabilities} onChange={(next) => { setProbabilitiesFor(next ? selected.code : null) }} tr={tr} />
                  </>
                ) : selected.op === 'ai_filter' || selected.op === 'ai_classifier' ? null : (
                  <span className="pg-count">{tr('judge.total', { count: formatCount(selected.count) })}</span>
                )}
              </div>
            </header>
            {output && outputState !== 'done' ? <p className="pg-outputs-note">{tr(outputState === 'running' ? 'judge.incomplete' : 'judge.stopped')}</p> : null}
            {selected.op === 'ai_filter' ? (
              <FilterResults key={selected.code} node={selected} revision={revision} t={t} />
            ) : selected.op === 'ai_classifier' ? (
              <ClassifierOutputs key={selected.code} node={selected} nodes={nodes} revision={revision} onSelect={setSelectedCode} t={t} />
            ) : (
              <MemberList
                key={`${selected.code}:${probabilities ? 'p' : ''}`}
                node={selected}
                revision={revision}
                probabilities={probabilities}
                labelNames={labelNames}
                emptyText={output ? tr('judge.empty') : undefined}
                t={t}
              />
            )}
          </section>
        )}
      </div>

      {expanded ? (
        <div className="pg-overlay" role="presentation" onClick={closeExpanded}>
          <div className="pg-modal pg-graph-dialog" role="dialog" aria-modal="true" aria-label={graph?.flow?.name || tr('graph.title')} onClick={event => event.stopPropagation()}>
            <header className="pg-head">
              <h2>{graph?.flow?.name || tr('graph.title')}</h2>
              <button type="button" className="pg-iconbtn" title={tr('graph.close')} aria-label={tr('graph.close')} onClick={closeExpanded}>
                <X size={16} aria-hidden />
              </button>
            </header>
            <div className="pg-graph-dialog-body">
              <BuildGraph
                nodes={nodes}
                selectedCode={selectedCode}
                onSelect={inspect}
                onInspect={inspect}
                focusCode={expandedFocus}
                onViewportChange={setDialogViewport}
                zoomOnScroll
                rightPaneOpen={detail !== null}
                className="is-expanded"
                t={t}
              />
              {paneDetail.shown === null ? null : (
                <NodeDetail
                  node={paneDetail.shown}
                  nodes={nodes}
                  onClose={() => setDetailCode(null)}
                  onChanged={refresh}
                  variant="pane"
                  closing={paneDetail.closing}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {expanded || detail === null ? null : (
        <div className="pg-overlay" role="presentation" onClick={() => setDetailCode(null)}>
          <div className="pg-inspector-wrap" onClick={event => event.stopPropagation()}>
            <NodeDetail node={detail} nodes={nodes} onClose={() => setDetailCode(null)} onChanged={refresh} t={t} />
          </div>
        </div>
      )}
    </div>
  )
}
