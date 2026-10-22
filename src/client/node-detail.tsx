/**
 * Node detail: identity, size and operator, the localized definition, judging
 * progress and controls for AI nodes, the inputs, and the JSON export.
 * Rendered as a modal next to the inline graph, or as a column beside the
 * expanded graph.
 */

import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { OP_ICONS } from './graph.tsx'
import { describeNode, describeUniverse } from './describe.ts'
import { controlJudging, downloadExport, isJudging, type NodeView } from './sets-api.ts'
import { errorMessage, formatCount } from './http.ts'
import { translator, type LocaleKey, type Translate } from './i18n.ts'

function Stat({ label, value }: { label: string, value: React.ReactNode }): JSX.Element {
  return (
    <div className="pg-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Panel({ title, children }: { title: string, children: React.ReactNode }): JSX.Element {
  return (
    <section className="pg-panel">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

function Kv({ label, value }: { label: string, value: React.ReactNode }): JSX.Element {
  return (
    <div className="pg-kv">
      <dt title={label}>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function inputLabel(node: NodeView, role: string, index: number, tr: Translate): string {
  if (node.op === 'subtract') return role === 'remove' ? tr('detail.subtract') : tr('detail.base')
  if (node.op === 'union') return tr('detail.input', { index: index + 1 })
  return tr('detail.parent')
}

export function NodeDetail({
  node,
  nodes,
  onClose,
  onChanged,
  variant = 'dialog',
  closing = false,
  t,
}: {
  node: NodeView
  /** Every node of the flow, to name the inputs. */
  nodes: readonly NodeView[]
  onClose: () => void
  /** Called after a judging control changed the node, to refresh the graph. */
  onChanged: () => void
  /**
   * `dialog` is the inline modal; `pane` is the 22rem column beside the
   * expanded graph, with no backdrop of its own so the graph stays clickable.
   */
  variant?: 'dialog' | 'pane'
  /** The pane is fading out: it no longer takes focus or pointer input. */
  closing?: boolean
  t?: (key: string) => string
}): JSX.Element {
  const tr: Translate = translator(t)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const Icon = OP_ICONS[node.op]
  const judging = node.op === 'ai_filter' || node.op === 'ai_classifier'
  const running = isJudging(node)
  const byCode = new Map(nodes.map(item => [item.code, item]))
  const definition = describeNode(node, nodes, tr)

  const act = (work: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    work()
      .then(() => { onChanged() })
      .catch((reason: unknown) => { setError(errorMessage(reason)) })
      .finally(() => { setBusy(false) })
  }

  const Shell = variant === 'pane' ? 'aside' : 'div'
  return (
    <Shell
      className={variant === 'pane' ? 'pg-inspector-pane' : 'pg-modal pg-inspector'}
      role={variant === 'pane' ? undefined : 'dialog'}
      aria-label={node.name}
      data-state={closing ? 'closed' : 'open'}
      {...(closing ? { inert: '' } : {})}
    >
      <header className="pg-inspector-head">
        <span className="pg-inspector-glyph"><Icon size={16} aria-hidden /></span>
        <h3>{node.name}</h3>
        <button type="button" className="pg-inspector-close" title={tr('graph.close')} onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </header>

      <div className="pg-inspector-body">
        <dl className="pg-stats">
          <Stat label={tr('detail.code')} value={<code>{node.code}</code>} />
          <Stat label={tr('detail.size')} value={<span className="pg-num">{formatCount(node.count)}</span>} />
          <Stat label={tr('graph.op')} value={tr(`op.${node.op}` as LocaleKey)} />
        </dl>

        {node.error === undefined ? null : (
          <Panel title={tr('detail.error')}>
            <p className="pg-panel-text">{node.error}</p>
          </Panel>
        )}

        {node.universe !== undefined || definition.length > 0 ? (
          <Panel title={node.op === 'seed' ? tr('detail.source') : tr('detail.params')}>
            {node.universe === undefined ? null : <p className="pg-panel-text">arXiv · {describeUniverse(node, tr)}</p>}
            {definition.map(line => <p key={line} className="pg-panel-text">{line}</p>)}
          </Panel>
        ) : null}

        {judging ? (
          <Panel title={tr('detail.judge')}>
            <Kv label={tr('graph.backend')} value="Jev" />
            {node.model === undefined ? null : <Kv label={tr('detail.model')} value={<code>{node.model}</code>} />}
            <Kv
              label={tr('detail.progress')}
              value={tr('detail.judged', { judged: formatCount(node.judged ?? 0), total: formatCount((node.judged ?? 0) + (node.undecided ?? 0)) })}
            />
            {node.excluded === undefined ? null : <Kv label={tr('detail.excluded')} value={formatCount(node.excluded)} />}
            {node.job === undefined ? null : (
              <Kv label={tr('detail.job')} value={`${tr(`job.${node.job.status}` as LocaleKey)}${node.job.lastError === null ? '' : ` — ${node.job.lastError}`}`} />
            )}
          </Panel>
        ) : null}

        {node.criteria === undefined ? null : (
          <Panel title={tr('detail.criteria')}>
            <p className="pg-panel-text">{node.criteria}</p>
          </Panel>
        )}

        {node.classes === undefined ? null : (
          <Panel title={tr('detail.classes')}>
            {node.classes.map(item => (
              <Kv key={item.key} label={item.name} value={tr('graph.members', { count: formatCount(item.count) })} />
            ))}
            <Kv label={tr('detail.other')} value={tr('graph.members', { count: formatCount(node.other ?? 0) })} />
            <Kv label={tr('detail.uncertain')} value={tr('graph.members', { count: formatCount(node.uncertain ?? 0) })} />
          </Panel>
        )}

        {node.parents.length === 0 ? null : (
          <Panel title={tr('detail.inputs')}>
            {node.parents.map((parent, index) => {
              const source = byCode.get(parent.code)
              return (
                <Kv
                  key={`${parent.role}:${parent.code}`}
                  label={inputLabel(node, parent.role, index, tr)}
                  value={`${source?.name ?? parent.code} · ${tr('graph.members', { count: formatCount(source?.count ?? 0) })}`}
                />
              )
            })}
          </Panel>
        )}

        {error === null ? null : <p className="pg-error">{error}</p>}

        {judging && running ? (
          <button type="button" className="pg-export" disabled={busy} onClick={() => { act(async () => { await controlJudging(node.code, 'cancel') }) }}>
            {tr('detail.cancel')}
          </button>
        ) : null}
        {judging && !running && (node.undecided ?? 0) > 0 ? (
          <button type="button" className="pg-export" disabled={busy} onClick={() => { act(async () => { await controlJudging(node.code, 'resume') }) }}>
            {tr('detail.resume')}
          </button>
        ) : null}

        <button
          type="button"
          className="pg-export"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            downloadExport(node.code)
              .catch((reason: unknown) => { setError(errorMessage(reason)) })
              .finally(() => { setBusy(false) })
          }}
        >
          <Download size={14} aria-hidden /> {busy ? tr('graph.exporting') : tr('graph.export')}
        </button>
      </div>
    </Shell>
  )
}
