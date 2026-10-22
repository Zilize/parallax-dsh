/**
 * Paper lists:
 *
 *  - the default view is the plain paper row (title with rank, right-aligned
 *    date, a mono id + author line, a quiet icon row) — judgements are never
 *    printed on it;
 *  - the probability view (`probabilities`) swaps each row for the title plus
 *    the Jev conclusion: the accepted / uncertain labels with their
 *    probability, and an "all probabilities" disclosure;
 *  - both views share one footer: "load more" + "N shown" while more pages
 *    remain, "N total" once everything is listed; 12 papers per page.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ExternalLink, FileCode, FileText } from 'lucide-react'
import { loadMembers, type MemberPaper, type MemberStatus, type NodeView } from './sets-api.ts'
import { errorMessage, formatCount } from './http.ts'
import { translator, type LocaleKey, type Translate } from './i18n.ts'
import { AbstractPopover } from './abstract-popover.tsx'
import { openInApp } from './links.ts'

/** Page size of every paper list inside a set. */
const PAGE = 12

/** The arXiv pages linked from every row. */
const PAPER_LINKS: Array<{ kind: 'pdf' | 'html' | 'abs', label: LocaleKey, Icon: typeof FileText }> = [
  { kind: 'pdf', label: 'graph.pdf', Icon: FileText },
  { kind: 'html', label: 'graph.html', Icon: FileCode },
  { kind: 'abs', label: 'graph.open', Icon: ExternalLink },
]

/** 0.86 → 86%; anything below 1% reads <1%. */
function percent(p: number): string {
  const value = Math.round(p * 100)
  return value < 1 ? '<1%' : `${value}%`
}

function Row({ paper, rank, tr }: { paper: MemberPaper, rank: number, tr: Translate }): JSX.Element {
  return (
    <div className="pg-row">
      <div className="pg-row-title">
        <h3>
          <span className="pg-rank">#{rank}</span>
          <AbstractPopover abstract={paper.abstract} tr={tr}>
            <a className="pg-title-link" href={paper.absUrl} target="_blank" rel="noreferrer noopener" onClick={openInApp}>
              {paper.title}
            </a>
          </AbstractPopover>
        </h3>
        <span className="pg-date">{paper.publishedAt?.slice(0, 10) ?? ''}</span>
      </div>
      <div className="pg-row-meta">
        <code>{paper.sourceId}</code>
        <span className="pg-dot">·</span>
        <span className="pg-author">{paper.authors}</span>
      </div>
      <div className="pg-row-actions">
        {PAPER_LINKS.map(({ kind, label, Icon }) => (
          <span key={kind} className="pg-tip" data-tip={tr(label)}>
            <a className="pg-iconbtn" href={`https://arxiv.org/${kind}/${paper.sourceId}`} target="_blank" rel="noreferrer noopener" onClick={openInApp} aria-label={tr(label)}>
              <Icon size={14} aria-hidden />
            </a>
          </span>
        ))}
      </div>
    </div>
  )
}

function numberMap(value: unknown): Record<string, number> {
  if (value === null || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
}

/**
 * The judgement line under a title: the conclusion first, the full
 * distribution behind a disclosure. Single-label judgements carry a choice
 * distribution and a confidence; multi-label ones independent probabilities
 * per category and the borderline labels.
 */
function Probabilities({ paper, labelNames, tr }: { paper: MemberPaper, labelNames: ReadonlyMap<string, string>, tr: Translate }): JSX.Element | null {
  const decision = paper.decision
  if (decision === undefined) return null
  const probs = numberMap(decision.detail.probabilities)
  const entries = Object.entries(probs).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  const single = typeof decision.detail.choice === 'string'
  const name = (key: string): string => labelNames.get(key) ?? (key === 'other' ? tr('judge.other') : key)
  const accepted = decision.labels.filter(key => key in probs).sort((a, b) => probs[b] - probs[a])
  const pending = (Array.isArray(decision.detail.uncertain_labels) ? decision.detail.uncertain_labels as string[] : []).filter(key => key in probs)
  const candidates = single && typeof decision.detail.choice === 'string' && decision.detail.choice in probs ? [decision.detail.choice] : []
  const leading = accepted.length > 0
    ? accepted
    : decision.outcome === 'other' && 'other' in probs ? ['other'] : candidates
  const shown = leading.length > 0 ? leading : [entries[0][0]]
  const remaining = pending.filter(key => !shown.includes(key))
  const otherShown = decision.outcome === 'other' && shown[0] === 'other'
  return (
    <div className="pg-prob">
      <div className="pg-prob-line">
        {otherShown ? null : (
          <span className="pg-prob-key">
            {accepted.length > 0 ? tr('judge.accepted') : decision.outcome === 'other' ? tr('judge.other') : tr('judge.uncertain')}
          </span>
        )}
        {decision.outcome === 'other' && !otherShown ? <span>{tr('judge.topProbability')}</span> : null}
        {shown.map(key => (
          <span key={key} className="pg-num">{name(key)} <span className="pg-prob-key">{percent(probs[key])}</span></span>
        ))}
      </div>
      {remaining.length === 0 ? null : (
        <div className="pg-prob-line">
          <span className="pg-prob-key">{tr('judge.uncertain')}</span>
          {remaining.map(key => (
            <span key={key} className="pg-num">{name(key)} <span className="pg-prob-key">{percent(probs[key])}</span></span>
          ))}
        </div>
      )}
      <details className="pg-prob-all">
        <summary>
          {tr('judge.allProbabilities')}
          <ChevronDown size={12} aria-hidden />
        </summary>
        <dl className="pg-prob-table">
          {entries.map(([key, p]) => (
            <div key={key}>
              <dt>{name(key)}</dt>
              <dd className="pg-num">{percent(p)}</dd>
            </div>
          ))}
        </dl>
        {single && decision.score !== null ? <p className="pg-num">{tr('judge.confidence', { value: percent(decision.score) })}</p> : null}
      </details>
    </div>
  )
}

function ProbabilityRow({ paper, labelNames, tr }: { paper: MemberPaper, labelNames: ReadonlyMap<string, string>, tr: Translate }): JSX.Element {
  return (
    <div className="pg-row pg-row--reason">
      <AbstractPopover abstract={paper.abstract} tr={tr}>
        <a className="pg-title-link pg-reason-title" href={paper.absUrl} target="_blank" rel="noreferrer noopener" onClick={openInApp}>
          {paper.title}
        </a>
      </AbstractPopover>
      <Probabilities paper={paper} labelNames={labelNames} tr={tr} />
    </div>
  )
}

/**
 * Papers of one node in one status. `revision` changes whenever the node's
 * count or judging progress changes, which reloads the first page.
 */
export function MemberList({ node, status = 'member', revision, probabilities = false, labelNames, emptyText, t }: {
  node: NodeView
  status?: MemberStatus
  revision: string
  /** Show each paper's Jev conclusion instead of the plain row. */
  probabilities?: boolean
  /** Category key → name, for classification judgements. */
  labelNames: ReadonlyMap<string, string>
  emptyText?: string
  t?: (key: string) => string
}): JSX.Element {
  const tr = translator(t)
  const [papers, setPapers] = useState<MemberPaper[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadMembers(node.code, status, 0, PAGE)
      .then((page) => {
        if (!alive) return
        setPapers(page.papers)
        setTotal(page.total)
        setError(null)
      })
      .catch((reason: unknown) => { if (alive) setError(errorMessage(reason)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [node.code, status, revision])

  const more = (): void => {
    setLoading(true)
    loadMembers(node.code, status, papers.length, PAGE)
      .then((page) => {
        setPapers(current => [...current, ...page.papers])
        setTotal(page.total)
      })
      .catch((reason: unknown) => { setError(errorMessage(reason)) })
      .finally(() => { setLoading(false) })
  }

  if (error !== null) return <p className="pg-error">{tr('graph.failed', { message: error })}</p>
  if (papers.length === 0) return loading ? <p className="pg-hint">{tr('graph.loading')}</p> : <p className="pg-empty-note">{emptyText ?? tr('graph.noMembers')}</p>
  return (
    <>
      <div className="pg-list">
        {papers.map((paper, index) => probabilities
          ? <ProbabilityRow key={paper.sourceId} paper={paper} labelNames={labelNames} tr={tr} />
          : <Row key={paper.sourceId} paper={paper} rank={index + 1} tr={tr} />)}
      </div>
      {papers.length < total ? (
        <div className="pg-more">
          <button type="button" className="pg-btn pg-btn-more" disabled={loading} onClick={more}>
            <ChevronDown size={14} aria-hidden />
            {tr('judge.loadMore')}
          </button>
          <span className="pg-num">{tr('judge.shown', { shown: formatCount(papers.length) })}</span>
        </div>
      ) : (
        <p className="pg-foot">{tr('judge.total', { count: formatCount(total) })}</p>
      )}
    </>
  )
}
