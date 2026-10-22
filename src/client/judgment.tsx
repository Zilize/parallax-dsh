/**
 * The members section of the AI nodes:
 *
 *  - AI screening: plain-text tabs "included / excluded" filter one list, the
 *    judging backend chip sits on the right; rows are ordinary paper rows;
 *  - AI classification: one row per category (name, count, chevron) that
 *    selects its output node, then a collapsible "unassigned" group (other +
 *    uncertain) whose list can switch to the probability view;
 *  - classification output: a "back to classification" link above the
 *    header, the backend chip and the probability checkbox in it;
 *  - an amber banner above the graph while the selected node still has
 *    papers waiting for a judgement (red once judging failed).
 */

import { useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronRight, LoaderCircle, TriangleAlert } from 'lucide-react'
import { MemberList } from './papers.tsx'
import { isJudging, type NodeView } from './sets-api.ts'
import { formatCount } from './http.ts'
import { translator, type Translate } from './i18n.ts'

/** A classifier's progress: still judging, stopped with papers left, or done. */
export function classificationState(node: NodeView): 'done' | 'running' | 'stopped' {
  if (isJudging(node)) return 'running'
  return (node.undecided ?? 0) > 0 ? 'stopped' : 'done'
}

/** The judging-backend chip; Jev is the plugin's only backend. */
export function BackendChip({ tr }: { tr: Translate }): JSX.Element {
  return <span className="pg-backend">{tr('judge.backend')}</span>
}

/**
 * The "judgment probabilities" checkbox. A click only flips the view: it never
 * reaches the host (a disclosure summary would otherwise toggle open).
 */
export function ProbabilityToggle({ checked, onChange, tr }: { checked: boolean, onChange: (next: boolean) => void, tr: Translate }): JSX.Element {
  return (
    <label
      className="pg-check"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onChange(!checked)
      }}
    >
      <span className="pg-check-box" role="checkbox" aria-checked={checked} aria-label={tr('judge.probabilities')} tabIndex={0}
        onKeyDown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          event.stopPropagation()
          onChange(!checked)
        }}
      >
        {checked ? <Check size={11} strokeWidth={3} aria-hidden /> : null}
      </span>
      {tr('judge.probabilities')}
    </label>
  )
}

/** Plain-text tabs that filter one list: two weights of text, no track. */
function TextTabs<T extends string>({ items, value, onChange }: {
  items: Array<{ key: T, label: string }>
  value: T
  onChange: (key: T) => void
}): JSX.Element {
  return (
    <div className="pg-texttabs">
      {items.map(item => (
        <button key={item.key} type="button" aria-pressed={item.key === value} className={item.key === value ? 'is-active' : ''} onClick={() => { onChange(item.key) }}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** Banner above the graph while the selected node has papers waiting for a judgement. */
export function UndecidedBanner({ node, t }: { node: NodeView, t?: (key: string) => string }): JSX.Element | null {
  const tr = translator(t)
  const undecided = node.undecided ?? 0
  if (undecided === 0) return null
  const failed = node.job?.status === 'failed'
  const live = isJudging(node)
  return (
    <div role="status" className={`pg-banner${failed ? ' is-failed' : ''}`}>
      {live ? <LoaderCircle size={16} className="pg-spin" aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
      <p>
        {failed
          ? tr('judge.failed')
          : tr(live ? 'judge.undecidedRunning' : 'judge.undecidedIdle', { count: formatCount(undecided) })}
      </p>
    </div>
  )
}

/** AI screening results: included / excluded over the same list geometry. */
export function FilterResults({ node, revision, t }: { node: NodeView, revision: string, t?: (key: string) => string }): JSX.Element {
  const tr = translator(t)
  const [verdict, setVerdict] = useState<'member' | 'excluded'>('member')
  return (
    <div className="pg-judgment">
      <div className="pg-judgment-bar">
        <TextTabs
          items={[{ key: 'member', label: tr('judge.included') }, { key: 'excluded', label: tr('judge.excluded') }]}
          value={verdict}
          onChange={setVerdict}
        />
        <BackendChip tr={tr} />
      </div>
      <MemberList key={verdict} node={node} status={verdict} revision={revision} labelNames={new Map()} emptyText={tr('judge.empty')} t={t} />
    </div>
  )
}

/**
 * The classifier's results: its categories as rows leading to their output
 * nodes, then the unassigned papers. The process (progress, criteria) lives in
 * the detail dialog.
 */
export function ClassifierOutputs({ node, nodes, revision, onSelect, t }: {
  node: NodeView
  nodes: readonly NodeView[]
  revision: string
  onSelect: (code: string) => void
  t?: (key: string) => string
}): JSX.Element {
  const tr = translator(t)
  const state = classificationState(node)
  const outputs = nodes.filter(item => item.op === 'classification_output' && item.parents[0]?.code === node.code)
  return (
    <div className="pg-outputs">
      {state === 'done' ? null : <p className="pg-outputs-note">{tr(state === 'running' ? 'judge.incomplete' : 'judge.stopped')}</p>}
      <div className="pg-outputs-list">
        {(node.classes ?? []).map((category) => {
          const output = outputs.find(item => (item.definition as { category?: string }).category === category.key)
          return (
            <button key={category.key} type="button" className="pg-output" disabled={output === undefined} onClick={() => { if (output !== undefined) onSelect(output.code) }}>
              <span className="pg-output-name">{category.name}</span>
              <span className="pg-output-side">
                <span className="pg-num">{tr('graph.members', { count: formatCount(output?.count ?? category.count) })}</span>
                <ChevronRight size={14} aria-hidden />
              </span>
            </button>
          )
        })}
      </div>
      <UnassignedGroup node={node} revision={revision} tr={tr} t={t} />
    </div>
  )
}

/**
 * The unassigned group: shown only when it has papers, closed by default, and
 * always reopened on the plain list rather than the probability view.
 */
function UnassignedGroup({ node, revision, tr, t }: { node: NodeView, revision: string, tr: Translate, t?: (key: string) => string }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [probabilities, setProbabilities] = useState(false)
  const total = (node.other ?? 0) + (node.uncertain ?? 0)
  const labelNames = new Map((node.classes ?? []).map(item => [item.key, item.name]))
  if (total <= 0) return null
  return (
    <details
      className="pg-review"
      onToggle={(event) => {
        setOpen(event.currentTarget.open)
        if (!event.currentTarget.open) setProbabilities(false)
      }}
    >
      <summary>
        <span className="pg-num">{tr('judge.reviewGroup', { name: tr('judge.unassigned'), count: formatCount(total) })}</span>
        <span className="pg-review-side">
          <ProbabilityToggle checked={probabilities} onChange={setProbabilities} tr={tr} />
          <ChevronDown size={14} className="pg-review-chevron" aria-hidden />
        </span>
      </summary>
      {open ? (
        <div className="pg-review-body">
          <p className="pg-review-hint">{tr('judge.unassignedHint')}</p>
          <MemberList
            key={probabilities ? 'probabilities' : 'papers'}
            node={node}
            status="unassigned"
            revision={revision}
            probabilities={probabilities}
            labelNames={labelNames}
            emptyText={tr('judge.empty')}
            t={t}
          />
        </div>
      ) : null}
    </details>
  )
}

/** "Back to classification" above an output node's header. */
export function ClassifierBackLink({ node, nodes, onSelect, t }: {
  node: NodeView
  nodes: readonly NodeView[]
  onSelect: (code: string) => void
  t?: (key: string) => string
}): JSX.Element | null {
  const tr = translator(t)
  if (node.op !== 'classification_output') return null
  const parent = nodes.find(item => item.code === node.parents[0]?.code && item.op === 'ai_classifier')
  if (parent === undefined) return null
  return (
    <button type="button" className="pg-back" onClick={() => { onSelect(parent.code) }}>
      <ArrowLeft size={14} aria-hidden />
      {tr('judge.back')}
    </button>
  )
}
