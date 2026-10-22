/**
 * Model-facing `parallax` tool: read-only access to the local arXiv corpus.
 *
 * The research skill uses it for discovery and to load its own documents.
 * One tool with an `action` parameter keeps the always-on schema cost small
 * (the schema is in every request, unlike the skill body).
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { TEXT_OUTPUT, type ToolRegistry } from './host.ts'
import { corpusSummary, getCorpusPaper, searchCorpus, type CorpusPaper } from './ingest/corpus.ts'
import { getCategories, publishedCompleteness, type PublishedCompleteness } from './ingest/db.ts'
import { SKILL_DIR } from './skills/provider.ts'
import { clampedInt, clipAbstract, optionalDate, optionalString, optionalStringList, parseAction } from './tool-args.ts'

const ACTIONS = ['status', 'search', 'paper', 'doc'] as const
const MAX_ABSTRACT = 900
/** Abstracts longer than this are cut even in full paper records. */
const MAX_FULL_ABSTRACT = 4000
/** action=paper batch size: full abstracts of a trial's borderline sample fit in one call. */
const MAX_PAPER_IDS = 20
const DOC_PATH_RE = /^(?:SKILL\.md|guides\/[a-z0-9-]+\.md|cases\/[a-z0-9-]+\.md)$/

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

function paperIds(args: Record<string, unknown>): string[] {
  const single = optionalString(args.id, 'id')
  const ids = optionalStringList(args.ids, 'ids') ?? (single === undefined ? [] : [single])
  if (ids.length === 0) throw new Error('action=paper requires id or ids')
  if (ids.length > MAX_PAPER_IDS) throw new Error(`ids takes at most ${MAX_PAPER_IDS} arXiv ids per call`)
  return ids
}

/** Read one packaged skill document through an allowlisted relative path. */
async function readSkillDoc(path: string): Promise<string> {
  if (!DOC_PATH_RE.test(path)) {
    throw new Error('path must be SKILL.md, guides/<name>.md or cases/<name>.md')
  }
  const base = resolve(SKILL_DIR)
  const target = resolve(base, path)
  if (target !== base && !target.startsWith(`${base}\\`) && !target.startsWith(`${base}/`)) {
    throw new Error('path escapes the skill directory')
  }
  return await readFile(target, 'utf8')
}

function formatPaper(paper: CorpusPaper, includeAbstract = true): string {
  const lines = [
    `[${paper.sourceId}] ${paper.title}`,
    `Authors: ${paper.authors || '(unknown)'}`,
    `Published: ${paper.publishedAt ?? '(unknown)'}${paper.updatedAt === null ? '' : ` · updated ${paper.updatedAt}`}`,
    `Primary: ${paper.primaryCategory || '(unknown)'} · Categories: ${paper.categories || '(unknown)'}`,
  ]
  if (paper.comments !== null && paper.comments !== '') lines.push(`Comments: ${paper.comments}`)
  if (paper.journalRef !== null && paper.journalRef !== '') lines.push(`Journal ref: ${paper.journalRef}`)
  if (paper.doi !== null && paper.doi !== '') lines.push(`DOI: ${paper.doi}`)
  lines.push(`Abs: ${paper.absUrl || '(none)'} · PDF: ${paper.pdfUrl || '(none)'}`)
  if (includeAbstract) lines.push(`Abstract: ${truncate(paper.abstract, MAX_FULL_ABSTRACT) || '(none)'}`)
  return lines.join('\n')
}

/** One-line statement of which submission dates the harvest vouches for. */
function completenessLine(completeness: PublishedCompleteness): string {
  if (completeness.since === null || completeness.through === null) {
    return 'Submission-date completeness: none. No unbroken run of fully harvested OAI datestamp days exists for the current scope, so no date range is complete.'
  }
  return [
    `Submission-date completeness: papers first submitted ${completeness.since}..${completeness.through} are covered`,
    `(every OAI datestamp day in that range is harvested; a paper revised after ${completeness.through} may be missing until later days are harvested).`,
    `Papers submitted before ${completeness.since} appear only if they were revised inside harvested days: treat those dates as partial.`,
  ].join(' ')
}

/** Warning for a date-filtered search that reaches outside the vouched range, else undefined. */
function dateGapWarning(from: string | undefined, to: string | undefined, completeness: PublishedCompleteness): string | undefined {
  if (from === undefined && to === undefined) return undefined
  const { since, through } = completeness
  const outside = since === null || through === null
    || from === undefined || from < since
    || to === undefined || to > through
  if (!outside) return undefined
  return since === null || through === null
    ? 'Warning: no submission-date range is complete in the local corpus; results for this date filter are partial.'
    : `Warning: the date filter reaches outside ${since}..${through}, the only submission dates the harvest covers completely; results outside that range are partial.`
}

function formatSearch(
  args: { query?: string, from?: string, to?: string, categories?: string[], limit: number },
  papers: CorpusPaper[],
  completeness: PublishedCompleteness,
): string {
  const filters = [
    args.query === undefined || args.query === '' ? undefined : `query "${args.query}"`,
    args.from === undefined && args.to === undefined ? undefined : `${args.from ?? '…'}..${args.to ?? '…'}`,
    args.categories === undefined ? undefined : `categories ${args.categories.join(', ')}`,
  ].filter((value): value is string => value !== undefined)
  const header = [
    `Local Parallax corpus — ${filters.length === 0 ? 'newest papers' : filters.join(' · ')} · limit ${args.limit}`,
    `Returned ${papers.length} paper(s). This is recall from the harvested local corpus, not a coverage claim.`,
  ]
  const gap = dateGapWarning(args.from, args.to, completeness)
  if (gap !== undefined) header.push(gap)
  if (papers.length === 0) {
    header.push('No paper matched. The corpus only contains days harvested for the current category scope; try a shorter/broader query, a wider date range, or external discovery (web_search / arXiv).')
    return header.join('\n')
  }
  const body = papers.map((paper, index) => {
    return [
      `${index + 1}. ${formatPaper(paper, false)}`,
      `   Abstract: ${clipAbstract(paper.abstract, MAX_ABSTRACT, 'action=paper') || '(none)'}`,
    ].join('\n')
  })
  return `${header.join('\n')}\n\n${body.join('\n\n')}`
}

function formatStatus(summary: ReturnType<typeof corpusSummary>): string {
  const coverage = Object.entries(summary.coverage)
    .map(([status, days]) => `${status} ${days}`)
    .join(', ')
  const lines = [
    `Local Parallax corpus: ${summary.papers.toLocaleString('en-US')} papers.`,
    `Published range in corpus: ${summary.firstPublished ?? '(empty)'} .. ${summary.lastPublished ?? '(empty)'}.`,
    `Harvest scope: ${summary.categories.length === 0 ? '(no category scope configured)' : summary.categories.join(', ')}.`,
    `OAI datestamp days (a datestamp is a record's last metadata change, not its submission date): ${coverage || 'none'}; latest completed day: ${summary.lastDoneDay ?? 'none'}.`,
    completenessLine(summary.completeness),
  ]
  if (summary.topPrimaryCategories.length > 0) {
    lines.push(`Top primary categories: ${summary.topPrimaryCategories.map(row => `${row.category} ${row.papers}`).join(' · ')}`)
  }
  lines.push('Only harvested days are covered. Dates or categories outside this scope must be discovered externally or harvested first (parallax_ingest).')
  return lines.join('\n')
}

export function registerParallaxTool(tools: ToolRegistry, db: DatabaseSync): void {
  tools.register({
    name: 'parallax',
    description: [
      'Query the local Parallax arXiv corpus and load Parallax research-skill documents (read-only).',
      "action=status summarizes what has been harvested; action=search recalls papers by keyword (all whitespace-separated terms must match title/abstract/authors) with optional from/to dates and arXiv categories; action=paper returns full metadata and the untrimmed abstract by arXiv id (id, or ids for up to 20 at once — use it to read trimmed or borderline abstracts); action=doc loads a guide or case of the parallax skill by relative path (SKILL.md, guides/<name>.md, cases/<name>.md).",
      'The corpus contains only days harvested in the Parallax ingest panel or with parallax_ingest; it is not all of arXiv and has no full text or citation graph. Use web_search/web_fetch for external discovery and cite the arXiv links. Build, screen and export paper sets with parallax_set.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'status: corpus coverage; search: keyword recall; paper: full metadata + abstract by id/ids; doc: load a skill guide/case.',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: `arXiv ids for action=paper, up to ${MAX_PAPER_IDS}; returns each paper with its full abstract.`,
        },
        query: {
          type: 'string',
          description: 'Search terms; every whitespace-separated term must appear. Omit to list the newest papers.',
        },
        id: {
          type: 'string',
          description: 'arXiv id for action=paper, e.g. 2401.01234 (an arXiv: prefix or version suffix is tolerated).',
        },
        path: {
          type: 'string',
          description: 'Relative skill document for action=doc: SKILL.md, guides/<name>.md or cases/<name>.md.',
        },
        limit: {
          type: 'number',
          description: 'Maximum papers to return, 1–50; default 20.',
        },
        from: {
          type: 'string',
          description: 'Inclusive lower bound on the first-submission date, YYYY-MM-DD.',
        },
        to: {
          type: 'string',
          description: 'Inclusive upper bound on the first-submission date, YYYY-MM-DD.',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'arXiv categories to match, OR semantics, exact token or group wildcard, e.g. ["cs.LG", "stat.ML"].',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<string> {
      exec.signal.throwIfAborted()
      const action = parseAction(args.action, ACTIONS)

      if (action === 'doc') {
        const path = optionalString(args.path, 'path')
        if (path === undefined) throw new Error('action=doc requires path')
        return await readSkillDoc(path)
      }

      if (action === 'status') return formatStatus(corpusSummary(db))

      if (action === 'paper') {
        const ids = paperIds(args)
        const found: string[] = []
        const missing: string[] = []
        for (const item of ids) {
          const paper = getCorpusPaper(db, item)
          if (paper === undefined) missing.push(item)
          else found.push(formatPaper(paper))
        }
        const note = missing.length === 0
          ? undefined
          : `Not in the local corpus: ${missing.join(', ')}. They may be outside the harvested scope; try web_search or the arXiv API.`
        return [...found, ...note === undefined ? [] : [note]].join('\n\n')
      }

      // search
      const from = optionalDate(args.from, 'from')
      const to = optionalDate(args.to, 'to')
      if (from !== undefined && to !== undefined && from > to) throw new Error('from must not be after to')
      const query = optionalString(args.query, 'query')
      const categories = optionalStringList(args.categories, 'categories')
      const limit = clampedInt(args.limit, 'limit', 20, 1, 50)
      const papers = searchCorpus(db, { query, limit, from, to, categories })
      return formatSearch({ query, from, to, categories, limit }, papers, publishedCompleteness(db, getCategories(db)))
    },
  })
}
