/**
 * Read-only corpus queries behind the model-facing `parallax` tool: keyword
 * recall with date and category filters, single-paper lookup and a coverage
 * summary. Results carry abstracts so the research skill can screen them.
 */

import type { DatabaseSync } from 'node:sqlite'

import { normalizeArxivId } from '../tool-args.ts'
import { getCategories, publishedCompleteness, type PublishedCompleteness } from './db.ts'

export interface CorpusPaper {
  sourceId: string
  title: string
  authors: string
  primaryCategory: string
  categories: string
  publishedAt: string | null
  updatedAt: string | null
  absUrl: string
  pdfUrl: string
  abstract: string
  comments: string | null
  journalRef: string | null
  doi: string | null
}

export interface CorpusQuery {
  query?: string
  limit?: number
  from?: string
  to?: string
  categories?: string[]
}

export interface CorpusSummary {
  papers: number
  firstPublished: string | null
  lastPublished: string | null
  coverage: Record<string, number>
  lastDoneDay: string | null
  categories: string[]
  topPrimaryCategories: Array<{ category: string, papers: number }>
  /** Submission-date range the datestamp coverage vouches for (current scope). */
  completeness: PublishedCompleteness
}

const PAPER_COLUMNS = `
  source_id AS sourceId, title, authors, primary_category AS primaryCategory,
  categories, published_at AS publishedAt, updated_at AS updatedAt,
  abs_url AS absUrl, pdf_url AS pdfUrl, abstract,
  comments, journal_ref AS journalRef, doi
`

/** Escape one LIKE pattern's wildcard characters for `ESCAPE '\\'`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** Quote one term as an FTS5 phrase; on the trigram index that is a substring match. */
function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

/**
 * Recall papers by keyword substring with optional date/category filters.
 * A query is split on whitespace; every token must appear in the title,
 * abstract or authors (AND semantics). Tokens of 3+ characters go through the
 * `papers_fts` trigram index; shorter ones (below trigram length) fall back
 * to LIKE. An empty query returns the newest papers within the filters.
 */
export function searchCorpus(db: DatabaseSync, options: CorpusQuery = {}): CorpusPaper[] {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 50)
  const clauses: string[] = []
  const params: Array<string | number> = []

  if (options.from !== undefined && options.from !== '') {
    clauses.push('substr(published_at, 1, 10) >= ?')
    params.push(options.from)
  }
  if (options.to !== undefined && options.to !== '') {
    clauses.push('substr(published_at, 1, 10) <= ?')
    params.push(options.to)
  }
  if (options.categories !== undefined && options.categories.length > 0) {
    const exact = options.categories.filter(category => !category.endsWith('.*'))
    const groups = options.categories.filter(category => category.endsWith('.*')).map(category => category.slice(0, -1))
    const parts: string[] = []
    for (const category of exact) {
      parts.push(`(' ' || categories || ' ') LIKE ? ESCAPE '\\'`)
      params.push(`% ${escapeLike(category)} %`)
    }
    for (const prefix of groups) {
      parts.push(`(' ' || categories || ' ') LIKE ? ESCAPE '\\'`)
      params.push(`% ${escapeLike(prefix)}%`)
    }
    if (parts.length > 0) clauses.push(`(${parts.join(' OR ')})`)
  }

  const tokens = (options.query ?? '').trim().split(/\s+/).filter(token => token !== '')
  // Implicit AND between phrases is row-level, the same semantics as the LIKE path.
  const indexed = tokens.filter(token => [...token].length >= 3)
  if (indexed.length > 0) {
    clauses.push('source_id IN (SELECT source_id FROM papers_fts WHERE papers_fts MATCH ?)')
    params.push(indexed.map(ftsPhrase).join(' '))
  }
  for (const token of tokens.filter(token => [...token].length < 3)) {
    const pattern = `%${escapeLike(token)}%`
    clauses.push(`(title LIKE ? ESCAPE '\\' OR abstract LIKE ? ESCAPE '\\' OR authors LIKE ? ESCAPE '\\')`)
    params.push(pattern, pattern, pattern)
  }

  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
  return db.prepare(`
    SELECT ${PAPER_COLUMNS}
    FROM papers
    ${where}
    ORDER BY COALESCE(published_at, fetched_at) DESC
    LIMIT ?
  `).all(...params, limit) as unknown as CorpusPaper[]
}

/** Read one paper by its arXiv id (with or without an `arXiv:` prefix). */
export function getCorpusPaper(db: DatabaseSync, id: string): CorpusPaper | undefined {
  return db.prepare(`SELECT ${PAPER_COLUMNS} FROM papers WHERE source_id = ?`)
    .get(normalizeArxivId(id)) as unknown as CorpusPaper | undefined
}

/** Summarize what the local corpus actually covers. */
export function corpusSummary(db: DatabaseSync): CorpusSummary {
  const totals = db.prepare(`
    SELECT count(*) AS n, min(published_at) AS first, max(published_at) AS last
    FROM papers
  `).get() as { n?: number, first?: string | null, last?: string | null } | undefined

  const coverage: Record<string, number> = {}
  const rows = db.prepare('SELECT status, count(DISTINCT day) AS n FROM coverage GROUP BY status').all() as unknown as Array<{ status: string, n: number }>
  for (const row of rows) coverage[row.status] = Number(row.n)

  const latest = db.prepare("SELECT max(day) AS day FROM coverage WHERE status = 'done'")
    .get() as { day?: string | null } | undefined

  const categories = getCategories(db)
  const top = db.prepare(`
    SELECT primary_category AS category, count(*) AS papers
    FROM papers
    WHERE primary_category <> ''
    GROUP BY primary_category
    ORDER BY papers DESC
    LIMIT 12
  `).all() as unknown as Array<{ category: string, papers: number }>

  return {
    papers: Number(totals?.n ?? 0),
    firstPublished: totals?.first ?? null,
    lastPublished: totals?.last ?? null,
    coverage,
    lastDoneDay: latest?.day ?? null,
    categories,
    topPrimaryCategories: top.map(row => ({ category: row.category, papers: Number(row.papers) })),
    completeness: publishedCompleteness(db, categories),
  }
}
