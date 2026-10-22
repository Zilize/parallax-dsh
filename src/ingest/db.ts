/**
 * SQLite side of the arXiv ingestion: papers, the keyword index, per-day
 * coverage, harvest jobs and the small key/value settings table.
 *
 * `papers_fts` is an FTS5 **trigram** index, so a quoted phrase is a
 * case-insensitive substring match: recall is keyword-only, with no vectors.
 * A `coverage` row is identified by (day, hash of the category scope), so
 * changing the scope leaves earlier days partial until they are harvested
 * again for the new categories.
 */

import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { ArxivRecord } from './arxiv.ts'
import { categoriesOverlap, categoryCovered, expandCategories } from '../taxonomy.ts'

export interface CalendarDay {
  date: string
  status: 'done' | 'partial' | 'running' | 'failed' | 'missing'
  items: number
  lastError: string | null
  /** Requested category tokens this day has no coverage for (partial days). */
  missing?: string[]
  /** Category tokens that did cover this day. */
  covered?: string[]
}

/** A retry the harvest is waiting out, cleared once the next page lands. */
export interface RetryState {
  /** 1-based number of the retry about to happen. */
  attempt: number
  maxAttempts: number
  /** `timeout`, `HTTP 503`, or the transport error message. */
  reason: string
  waitMs: number
  at: string
}

/** A harvest job's live counters, saved after every page and day. */
export interface HarvestProgress {
  /** Masked proxy URL, or `direct`. */
  network: string
  retry: RetryState | null
  /** The day being harvested, null before the first one. */
  day: string | null
  pages?: number
  daysTotal: number
  daysDone: number
  /** Days skipped because the scope already covered them. */
  daysSkipped: number
  records: number
  matched: number
  inserted: number
  updated: number
  removed: number
}

export interface JobRecord {
  id: string
  status: 'running' | 'done' | 'failed' | 'canceled'
  params: { from: string, to: string, categories: string[] }
  /** Empty until the runner saves its first progress. */
  progress: Partial<HarvestProgress>
  lastError: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS papers (
  source_id        TEXT PRIMARY KEY,
  title            TEXT    NOT NULL,
  abstract         TEXT    NOT NULL DEFAULT '',
  authors          TEXT    NOT NULL DEFAULT '',
  primary_category TEXT    NOT NULL DEFAULT '',
  categories       TEXT    NOT NULL DEFAULT '',
  published_at     TEXT,
  updated_at       TEXT,
  arxiv_version    INTEGER,
  abs_url          TEXT    NOT NULL DEFAULT '',
  pdf_url          TEXT    NOT NULL DEFAULT '',
  comments         TEXT,
  journal_ref      TEXT,
  doi              TEXT,
  oai_identifier   TEXT    NOT NULL DEFAULT '',
  fetched_at       TEXT    NOT NULL,
  fts_rowid        INTEGER
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
  source_id UNINDEXED,
  title,
  abstract,
  authors,
  tokenize = 'trigram'
);

CREATE TABLE IF NOT EXISTS coverage (
  day            TEXT    NOT NULL,
  params_hash    TEXT    NOT NULL,
  params         TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  items_created  INTEGER NOT NULL DEFAULT 0,
  items_updated  INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT,
  finished_at    TEXT,
  last_error     TEXT,
  PRIMARY KEY (day, params_hash)
) STRICT;

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  params      TEXT NOT NULL,
  progress    TEXT NOT NULL DEFAULT '{}',
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ix_papers_published ON papers (published_at);
CREATE UNIQUE INDEX IF NOT EXISTS ix_papers_fts_rowid ON papers (fts_rowid);
`

const CATEGORIES_KEY = 'ingest.categories'
const LIBRARY_VERSION_KEY = 'library.version'

/** One value of the key/value settings table; empty reads as unset. */
export function readSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
  return row?.value === undefined || row.value === '' ? undefined : row.value
}

/** Store a setting; undefined or a blank value removes it. */
export function writeSetting(db: DatabaseSync, key: string, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    return
  }
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value.trim())
}

/** Monotonic corpus generation: sets that read papers re-evaluate when it moves. */
export function getLibraryVersion(db: DatabaseSync): number {
  return Number(readSetting(db, LIBRARY_VERSION_KEY) ?? 0)
}

/** Advance the corpus generation, inside the caller's transaction. */
export function bumpLibraryVersion(db: DatabaseSync): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, '1')
    ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
  `).run(LIBRARY_VERSION_KEY)
}

/** Create the ingestion tables if they do not exist yet. */
export function openIngestStore(db: DatabaseSync): void {
  db.exec(SCHEMA)
}

/**
 * Replace one paper's FTS row by its stored rowid (or create it and store the
 * rowid). `papers_fts.source_id` is UNINDEXED, so deleting by it would scan the
 * whole index, and the implicit `papers.rowid` may be renumbered by VACUUM.
 */
function writePaperIndex(
  db: DatabaseSync,
  sourceId: string,
  ftsRowid: number | null,
  fields: { title: string, abstract: string, authors: string },
): void {
  if (ftsRowid !== null) {
    db.prepare('DELETE FROM papers_fts WHERE rowid = ?').run(ftsRowid)
    db.prepare('INSERT INTO papers_fts (rowid, source_id, title, abstract, authors) VALUES (?, ?, ?, ?, ?)')
      .run(ftsRowid, sourceId, fields.title, fields.abstract, fields.authors)
    return
  }
  const inserted = db.prepare('INSERT INTO papers_fts (source_id, title, abstract, authors) VALUES (?, ?, ?, ?)')
    .run(sourceId, fields.title, fields.abstract, fields.authors)
  db.prepare('UPDATE papers SET fts_rowid = ? WHERE source_id = ?').run(Number(inserted.lastInsertRowid), sourceId)
}

/** Stable identity of a coverage scope: categories only, never the date range. */
function paramsHash(categories: readonly string[]): string {
  const payload = JSON.stringify({ categories: [...categories].sort() })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

/** The saved category scope; empty until the user picks one. */
export function getCategories(db: DatabaseSync): string[] {
  const value = readSetting(db, CATEGORIES_KEY)
  if (value === undefined) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function setCategories(db: DatabaseSync, categories: readonly string[]): void {
  writeSetting(db, CATEGORIES_KEY, JSON.stringify(categories))
}

export type UpsertOutcome = 'inserted' | 'updated'

/** Upsert one paper and keep its FTS row in sync, inside the caller's transaction. */
export function upsertPaper(db: DatabaseSync, record: ArxivRecord, fetchedAt: string): UpsertOutcome {
  const current = db.prepare('SELECT fts_rowid AS ftsRowid FROM papers WHERE source_id = ?')
    .get(record.sourceId) as { ftsRowid: number | null } | undefined
  db.prepare(`
    INSERT INTO papers (
      source_id, title, abstract, authors, primary_category, categories,
      published_at, updated_at, arxiv_version, abs_url, pdf_url,
      comments, journal_ref, doi, oai_identifier, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      title = excluded.title,
      abstract = excluded.abstract,
      authors = excluded.authors,
      primary_category = excluded.primary_category,
      categories = excluded.categories,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at,
      arxiv_version = excluded.arxiv_version,
      abs_url = excluded.abs_url,
      pdf_url = excluded.pdf_url,
      comments = excluded.comments,
      journal_ref = excluded.journal_ref,
      doi = excluded.doi,
      oai_identifier = excluded.oai_identifier,
      fetched_at = excluded.fetched_at
  `).run(
    record.sourceId,
    record.title,
    record.abstract,
    record.authors.join(', '),
    record.primaryCategory,
    record.categories.join(' '),
    record.publishedAt,
    record.updatedAt,
    record.arxivVersion,
    record.absUrl,
    record.pdfUrl,
    record.comments,
    record.journalRef,
    record.doi,
    record.oaiIdentifier,
    fetchedAt,
  )

  writePaperIndex(db, record.sourceId, current?.ftsRowid ?? null, {
    title: record.title,
    abstract: record.abstract,
    authors: record.authors.join(', '),
  })

  return current === undefined ? 'inserted' : 'updated'
}

/** Drop a paper the repository reports as deleted; false when it was never stored. */
export function removePaper(db: DatabaseSync, sourceId: string): boolean {
  const current = db.prepare('SELECT fts_rowid AS ftsRowid FROM papers WHERE source_id = ?')
    .get(sourceId) as { ftsRowid: number | null } | undefined
  if (current === undefined) return false
  if (current.ftsRowid !== null) db.prepare('DELETE FROM papers_fts WHERE rowid = ?').run(current.ftsRowid)
  db.prepare('DELETE FROM papers WHERE source_id = ?').run(sourceId)
  return true
}

export function markCoverageRunning(db: DatabaseSync, day: string, categories: readonly string[]): void {
  db.prepare(`
    INSERT INTO coverage (day, params_hash, params, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
    ON CONFLICT(day, params_hash) DO UPDATE SET
      status = 'running', started_at = excluded.started_at, finished_at = NULL, last_error = NULL
  `).run(day, paramsHash(categories), JSON.stringify({ categories: [...categories].sort() }), new Date().toISOString())
}

export function markCoverageDone(db: DatabaseSync, day: string, categories: readonly string[], created: number, updated: number): void {
  db.prepare(`
    UPDATE coverage SET status = 'done', items_created = ?, items_updated = ?, finished_at = ?
    WHERE day = ? AND params_hash = ?
  `).run(created, updated, new Date().toISOString(), day, paramsHash(categories))
}

export function markCoverageFailed(db: DatabaseSync, day: string, categories: readonly string[], error: string): void {
  db.prepare(`
    UPDATE coverage SET status = 'failed', finished_at = ?, last_error = ?
    WHERE day = ? AND params_hash = ?
  `).run(new Date().toISOString(), error.slice(0, 2000), day, paramsHash(categories))
}

/** Drop `running` rows left behind by a process that died mid-harvest. */
export function failStaleCoverage(db: DatabaseSync): void {
  db.prepare(`
    UPDATE coverage SET status = 'failed', finished_at = ?, last_error = ?
    WHERE status = 'running'
  `).run(new Date().toISOString(), 'the previous process stopped before this day finished')
}

interface CoverageDbRow {
  day: string
  params: string
  status: string
  items_created: number
  items_updated: number
  last_error: string | null
}

function categoriesOf(params: string): string[] {
  try {
    const parsed = JSON.parse(params) as { categories?: unknown }
    return Array.isArray(parsed.categories) ? parsed.categories.map(String) : []
  } catch {
    return []
  }
}

/** Category codes a day already holds as done, expanded from every done row. */
export function coveredCategoriesForDay(db: DatabaseSync, day: string): Set<string> {
  const rows = db.prepare("SELECT params FROM coverage WHERE day = ? AND status = 'done'").all(day) as Array<{ params: string }>
  const covered = new Set<string>()
  for (const row of rows) for (const code of expandCategories(categoriesOf(row.params))) covered.add(code)
  return covered
}

export interface PublishedCompleteness {
  /** First day of the newest unbroken run of fully harvested datestamp days. */
  since: string | null
  /** Last day of that run. */
  through: string | null
}

/**
 * What the datestamp coverage proves about *submission* dates. A paper's
 * datestamp only moves forward (each revision or metadata fix re-stamps it),
 * so once every datestamp day `since..through` is harvested for the scope,
 * papers first submitted in that range are in the corpus — apart from those
 * re-stamped after `through` before their earlier day was harvested. Papers
 * submitted before `since` are present only if revised inside harvested days.
 */
export function publishedCompleteness(db: DatabaseSync, categories: readonly string[]): PublishedCompleteness {
  const rows = db.prepare("SELECT day, params FROM coverage WHERE status = 'done' ORDER BY day").all() as Array<{ day: string, params: string }>
  const requested = expandCategories(categories)
  const coveredByDay = new Map<string, Set<string>>()
  for (const row of rows) {
    const covered = coveredByDay.get(row.day) ?? new Set<string>()
    for (const code of expandCategories(categoriesOf(row.params))) covered.add(code)
    coveredByDay.set(row.day, covered)
  }
  const full = (day: string): boolean => {
    const covered = coveredByDay.get(day)
    if (covered === undefined) return false
    return requested.every(token => categoryCovered(token, covered))
  }

  const days = [...coveredByDay.keys()].sort()
  let through: string | null = null
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (full(days[index])) { through = days[index]; break }
  }
  if (through === null) return { since: null, through: null }

  const cursor = new Date(`${through}T00:00:00Z`)
  let since = through
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    const day = cursor.toISOString().slice(0, 10)
    if (!full(day)) break
    since = day
  }
  return { since, through }
}

/**
 * The 365/366-day grid of one year for a scope. A failed or running row for
 * the exact scope wins; otherwise the day's done rows are merged, and the day
 * is done, partial or missing by how much of the scope they cover.
 */
export function buildCalendar(db: DatabaseSync, year: number, categories: readonly string[]): CalendarDay[] {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const rows = db.prepare(
    'SELECT day, params, status, items_created, items_updated, last_error FROM coverage WHERE day >= ? AND day <= ?',
  ).all(from, to) as unknown as CoverageDbRow[]

  const byDay = new Map<string, CoverageDbRow[]>()
  for (const row of rows) {
    const list = byDay.get(row.day)
    if (list === undefined) byDay.set(row.day, [row])
    else list.push(row)
  }

  const requested = new Set(expandCategories(categories))
  const exact = paramsHash(expandCategories(categories))
  const days: CalendarDay[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  while (cursor.toISOString().slice(0, 10) <= to) {
    const day = cursor.toISOString().slice(0, 10)
    const dayRows = byDay.get(day) ?? []
    const exactRow = dayRows.find(row => paramsHash(expandCategories(categoriesOf(row.params))) === exact)
    if (exactRow !== undefined && (exactRow.status === 'running' || exactRow.status === 'failed')) {
      days.push({
        date: day,
        status: exactRow.status as 'running' | 'failed',
        items: exactRow.items_created + exactRow.items_updated,
        lastError: exactRow.last_error,
        missing: [],
        covered: categoriesOf(exactRow.params),
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      continue
    }

    const covered = new Set<string>()
    let items = 0
    let lastError: string | null = null
    for (const row of dayRows) {
      if (row.status !== 'done') continue
      const rowScope = expandCategories(categoriesOf(row.params))
      if (requested.size > 0 && !categoriesOverlap(requested, new Set(rowScope))) continue
      for (const token of rowScope) covered.add(token)
      items += row.items_created + row.items_updated
      lastError = lastError ?? row.last_error
    }

    let status: CalendarDay['status'] = 'missing'
    if (requested.size > 0 && [...requested].every(token => categoryCovered(token, covered))) status = 'done'
    else if (requested.size > 0 && categoriesOverlap(requested, covered)) status = 'partial'
    else if (requested.size === 0 && dayRows.some(row => row.status === 'done')) status = 'done'

    const missing = [...requested].filter(token => !categoryCovered(token, covered))
    days.push({ date: day, status, items, lastError, missing, covered: [...covered] })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export function createJob(db: DatabaseSync, id: string, params: JobRecord['params']): void {
  const at = new Date().toISOString()
  db.prepare("INSERT INTO jobs (id, status, params, progress, created_at, started_at) VALUES (?, 'running', ?, '{}', ?, ?)")
    .run(id, JSON.stringify(params), at, at)
}

export function updateJobProgress(db: DatabaseSync, id: string, progress: HarvestProgress): void {
  db.prepare('UPDATE jobs SET progress = ? WHERE id = ?').run(JSON.stringify(progress), id)
}

export function finishJob(db: DatabaseSync, id: string, status: JobRecord['status'], lastError: string | null = null): void {
  db.prepare('UPDATE jobs SET status = ?, last_error = ?, finished_at = ? WHERE id = ?')
    .run(status, lastError, new Date().toISOString(), id)
}

function toJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    status: row.status as JobRecord['status'],
    params: JSON.parse(String(row.params)) as JobRecord['params'],
    progress: JSON.parse(String(row.progress ?? '{}')) as Partial<HarvestProgress>,
    lastError: row.last_error === null ? null : String(row.last_error),
    createdAt: String(row.created_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
  }
}

export function getJob(db: DatabaseSync, id: string): JobRecord | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row === undefined ? null : toJob(row)
}

/** Recent harvest jobs, newest first. */
export function listJobs(db: DatabaseSync, limit: number): JobRecord[] {
  return (db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as Array<Record<string, unknown>>).map(toJob)
}

export function latestJob(db: DatabaseSync): JobRecord | null {
  return listJobs(db, 1)[0] ?? null
}

/** Mark jobs that were running when the process stopped. */
export function failStaleJobs(db: DatabaseSync): void {
  db.prepare("UPDATE jobs SET status = 'failed', last_error = ?, finished_at = ? WHERE status = 'running'")
    .run('the previous process stopped during this run', new Date().toISOString())
}

export function countPapers(db: DatabaseSync): number {
  const row = db.prepare('SELECT count(*) AS n FROM papers').get() as { n?: number } | undefined
  return Number(row?.n ?? 0)
}
