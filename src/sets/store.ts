/**
 * Set algebra on SQLite:
 *
 *  - a **flow** is one conversation's build (one per root session); every set
 *    belongs to exactly one flow and may only derive from sets of that flow;
 *  - a **set** is immutable: name, operator, parameters and parent edges are
 *    fixed at creation; any change is a new node, so the lineage stays legible;
 *  - members are never stored as facts. Each set is re-evaluated lazily when
 *    its cache key (operator, parameters, parent keys, judgement revision and
 *    — for corpus readers — the library version) changes, and memoized in
 *    `set_members`;
 *  - Jev judgements are the only facts (`set_decisions`), one per paper per
 *    judging node, so re-judging after the parent grows only pays for the
 *    new papers.
 *
 * Operators: `seed`, `rule_filter`, `union`, `subtract` (free, synchronous) and
 * `ai_filter`, `ai_classifier` + its `classification_output` children (Jev,
 * asynchronous). There are no collections and no delivery; a set leaves the
 * plugin only as an exported JSON document.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { getLibraryVersion } from '../ingest/db.ts'
import { compileRules, describeRule, describeScope, scopeRules, type Rule, type Scope } from './rules.ts'

export type Op = 'seed' | 'rule_filter' | 'union' | 'subtract' | 'ai_filter' | 'ai_classifier' | 'classification_output'
export type EdgeRole = 'base' | 'union' | 'remove'

export interface Category {
  key: string
  name: string
  criteria: string
}

export interface Thresholds {
  /** ai_filter: include when the Noul probability is at least this. */
  noul: number
  /** multi-label classification: accept a label at or above this. */
  label: number
  /** multi-label classification: below `label` but at least this is borderline. */
  labelFloor: number
  /** single-label classification: below this confidence the paper is uncertain. */
  choiceFloor: number
}

/** Decision thresholds frozen into every new AI node. */
export const DEFAULT_THRESHOLDS: Thresholds = { noul: 0.5, label: 0.8, labelFloor: 0.2, choiceFloor: 0.8 }

export interface SeedParams { ids: string[] }
export interface RuleParams { scope?: Scope, rules: Rule[] }
export interface FilterParams { criteria: string, model: string, thresholds: Thresholds }
export interface ClassifierParams { categories: Category[], mode: 'single_label' | 'multi_label', model: string, thresholds: Thresholds }
export interface OutputParams { category: string }

export interface SetRow {
  id: string
  flowId: string
  code: string
  name: string
  op: Op
  params: Record<string, unknown>
  revision: number
  createdAt: string
}

export interface EdgeRow {
  parentId: string
  role: EdgeRole
  position: number
}

export interface FlowRow {
  id: string
  sessionId: string
  name: string
  createdAt: string
  updatedAt: string
}

/** Members above this are refused: narrow the rules instead of materializing the corpus. */
const MAX_MEMBERS = 200_000

const SCHEMA = `
CREATE TABLE IF NOT EXISTS flows (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sets (
  id          TEXT PRIMARY KEY,
  flow_id     TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  op          TEXT NOT NULL,
  params      TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_sets_flow ON sets (flow_id, created_at);

CREATE TABLE IF NOT EXISTS set_edges (
  set_id     TEXT NOT NULL,
  parent_id  TEXT NOT NULL,
  role       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (set_id, role, position)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_set_edges_parent ON set_edges (parent_id);

CREATE TABLE IF NOT EXISTS set_decisions (
  set_id      TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  labels      TEXT NOT NULL DEFAULT ' ',
  score       REAL,
  detail      TEXT NOT NULL DEFAULT '{}',
  model       TEXT,
  decided_at  TEXT NOT NULL,
  PRIMARY KEY (set_id, source_id)
) STRICT;

CREATE TABLE IF NOT EXISTS set_members (
  set_id     TEXT NOT NULL,
  position   INTEGER NOT NULL,
  source_id  TEXT NOT NULL,
  PRIMARY KEY (set_id, position)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_set_members_item ON set_members (set_id, source_id);

CREATE TABLE IF NOT EXISTS set_cache (
  set_id     TEXT PRIMARY KEY,
  cache_key  TEXT NOT NULL,
  count      INTEGER NOT NULL,
  built_at   TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS judge_jobs (
  id             TEXT PRIMARY KEY,
  set_id         TEXT NOT NULL,
  status         TEXT NOT NULL,
  total          INTEGER NOT NULL,
  judged         INTEGER NOT NULL DEFAULT 0,
  requests       INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS ix_judge_jobs_set ON judge_jobs (set_id, created_at);
`

/** Create the set tables if they do not exist yet. */
export function openSetStore(db: DatabaseSync): void {
  db.exec(SCHEMA)
}

const now = (): string => new Date().toISOString()

/** Run `fn` atomically; nests safely inside an outer transaction. */
export function atomically<T>(db: DatabaseSync, fn: () => T): T {
  const name = `sp_${randomUUID().replace(/-/g, '')}`
  db.exec(`SAVEPOINT ${name}`)
  try {
    const result = fn()
    db.exec(`RELEASE ${name}`)
    return result
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`)
    db.exec(`RELEASE ${name}`)
    throw error
  }
}

// -- flows ----------------------------------------------------------------

interface FlowDbRow { id: string, session_id: string, name: string, created_at: string, updated_at: string }

function toFlow(row: FlowDbRow): FlowRow {
  return { id: row.id, sessionId: row.session_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function flowForSession(db: DatabaseSync, sessionId: string): FlowRow | undefined {
  const row = db.prepare('SELECT * FROM flows WHERE session_id = ?').get(sessionId) as FlowDbRow | undefined
  return row === undefined ? undefined : toFlow(row)
}

export function getFlow(db: DatabaseSync, id: string): FlowRow | undefined {
  const row = db.prepare('SELECT * FROM flows WHERE id = ?').get(id) as FlowDbRow | undefined
  return row === undefined ? undefined : toFlow(row)
}

/** The flow of a root session, created on first use. */
export function ensureFlow(db: DatabaseSync, sessionId: string): FlowRow {
  const existing = flowForSession(db, sessionId)
  if (existing !== undefined) return existing
  const at = now()
  const id = randomUUID()
  db.prepare('INSERT INTO flows (id, session_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, sessionId, '', at, at)
  return { id, sessionId, name: '', createdAt: at, updatedAt: at }
}

export function touchFlow(db: DatabaseSync, flowId: string): void {
  db.prepare('UPDATE flows SET updated_at = ? WHERE id = ?').run(now(), flowId)
}

export interface FlowSummary {
  id: string
  sessionId: string
  name: string
  createdAt: string
  updatedAt: string
  setCount: number
  /** Newest sets first, with their last evaluated size (no re-evaluation). */
  sets: Array<{ code: string, name: string, op: Op, count: number | null }>
}

/** Flows that hold at least one set, newest activity first. Reads cached counts only. */
export function listFlows(db: DatabaseSync, limit = 50): FlowSummary[] {
  const flows = db.prepare(`
    SELECT f.*, (SELECT count(*) FROM sets s WHERE s.flow_id = f.id) AS set_count
    FROM flows f
    WHERE EXISTS (SELECT 1 FROM sets s WHERE s.flow_id = f.id)
    ORDER BY f.updated_at DESC
    LIMIT ?
  `).all(limit) as unknown as Array<FlowDbRow & { set_count: number }>
  const preview = db.prepare(`
    SELECT s.code, s.name, s.op, c.count
    FROM sets s LEFT JOIN set_cache c ON c.set_id = s.id
    WHERE s.flow_id = ?
    ORDER BY s.created_at DESC
    LIMIT 3
  `)
  return flows.map(row => ({
    ...toFlow(row),
    setCount: Number(row.set_count),
    sets: (preview.all(row.id) as unknown as Array<{ code: string, name: string, op: Op, count: number | null }>)
      .map(set => ({ code: set.code, name: set.name, op: set.op, count: set.count === null ? null : Number(set.count) })),
  }))
}

// -- sets -----------------------------------------------------------------

interface SetDbRow { id: string, flow_id: string, code: string, name: string, op: string, params: string, revision: number, created_at: string }

function toSet(row: SetDbRow): SetRow {
  return {
    id: row.id,
    flowId: row.flow_id,
    code: row.code,
    name: row.name,
    op: row.op as Op,
    params: JSON.parse(row.params) as Record<string, unknown>,
    revision: Number(row.revision),
    createdAt: row.created_at,
  }
}

export function getSet(db: DatabaseSync, id: string): SetRow | undefined {
  const row = db.prepare('SELECT * FROM sets WHERE id = ?').get(id) as SetDbRow | undefined
  return row === undefined ? undefined : toSet(row)
}

export function setByCode(db: DatabaseSync, code: string): SetRow | undefined {
  const row = db.prepare('SELECT * FROM sets WHERE code = ?').get(code.trim().toLowerCase()) as SetDbRow | undefined
  return row === undefined ? undefined : toSet(row)
}

export function setsOfFlow(db: DatabaseSync, flowId: string): SetRow[] {
  return (db.prepare('SELECT * FROM sets WHERE flow_id = ? ORDER BY created_at, rowid').all(flowId) as unknown as SetDbRow[]).map(toSet)
}

/**
 * Resolve a model-supplied reference (short code, or full id) inside one flow.
 * Sets of other flows are not addressable: a flow never reads another
 * conversation's intermediate state.
 */
export function resolveSet(db: DatabaseSync, flowId: string, ref: unknown, name = 'set'): SetRow {
  if (typeof ref !== 'string' || ref.trim() === '') throw new Error(`${name} must be a set code`)
  const set = setByCode(db, ref) ?? getSet(db, ref.trim())
  if (set === undefined || set.flowId !== flowId) {
    throw new Error(`${name} "${ref}" is not a set of this conversation's flow; use a code from action=inspect`)
  }
  return set
}

function edgesOf(db: DatabaseSync, setId: string): EdgeRow[] {
  return (db.prepare("SELECT parent_id, role, position FROM set_edges WHERE set_id = ? ORDER BY CASE role WHEN 'base' THEN 0 WHEN 'union' THEN 1 ELSE 2 END, position")
    .all(setId) as unknown as Array<{ parent_id: string, role: EdgeRole, position: number }>)
    .map(row => ({ parentId: row.parent_id, role: row.role, position: Number(row.position) }))
}

export function childrenOf(db: DatabaseSync, setId: string): SetRow[] {
  return (db.prepare('SELECT s.* FROM set_edges e JOIN sets s ON s.id = e.set_id WHERE e.parent_id = ? ORDER BY s.created_at')
    .all(setId) as unknown as SetDbRow[]).map(toSet)
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function newCode(db: DatabaseSync): string {
  const exists = db.prepare('SELECT 1 AS hit FROM sets WHERE code = ?')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = ''
    for (let index = 0; index < 8; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    if (exists.get(code) === undefined) return code
  }
  throw new Error('could not allocate a set code')
}

export interface NewSet {
  name: string
  op: Op
  params: Record<string, unknown>
  parents: Array<{ id: string, role: EdgeRole }>
}

/** Insert one set and its parent edges. Parents must already exist: the DAG is acyclic by construction. */
export function insertSet(db: DatabaseSync, flowId: string, spec: NewSet): SetRow {
  const name = spec.name.trim()
  if (name === '') throw new Error('name must not be empty')
  if ([...name].length > 120) throw new Error('name must be at most 120 characters')
  const row: SetRow = {
    id: randomUUID(),
    flowId,
    code: newCode(db),
    name,
    op: spec.op,
    params: spec.params,
    revision: 0,
    createdAt: now(),
  }
  atomically(db, () => {
    db.prepare('INSERT INTO sets (id, flow_id, code, name, op, params, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
      .run(row.id, flowId, row.code, row.name, row.op, JSON.stringify(row.params), row.createdAt)
    const positions = new Map<EdgeRole, number>()
    for (const parent of spec.parents) {
      const position = positions.get(parent.role) ?? 0
      positions.set(parent.role, position + 1)
      db.prepare('INSERT INTO set_edges (set_id, parent_id, role, position) VALUES (?, ?, ?, ?)').run(row.id, parent.id, parent.role, position)
    }
    db.prepare("UPDATE flows SET name = CASE WHEN name = '' THEN ? ELSE name END, updated_at = ? WHERE id = ?").run(row.name, row.createdAt, flowId)
  })
  return row
}

/** Judgements changed: bump the node's revision so it and its descendants re-evaluate. */
function bumpRevision(db: DatabaseSync, setId: string): void {
  db.prepare('UPDATE sets SET revision = revision + 1 WHERE id = ?').run(setId)
}

// -- decisions ------------------------------------------------------------

export interface Decision {
  sourceId: string
  /** ai_filter: include | exclude; ai_classifier: classified | other | uncertain. */
  outcome: string
  labels?: string[]
  score?: number | null
  detail?: Record<string, unknown>
  model?: string | null
}

export function writeDecisions(db: DatabaseSync, setId: string, decisions: readonly Decision[]): void {
  if (decisions.length === 0) return
  const statement = db.prepare(`
    INSERT INTO set_decisions (set_id, source_id, outcome, labels, score, detail, model, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id, source_id) DO UPDATE SET
      outcome = excluded.outcome, labels = excluded.labels, score = excluded.score,
      detail = excluded.detail, model = excluded.model, decided_at = excluded.decided_at
  `)
  const at = now()
  atomically(db, () => {
    for (const decision of decisions) {
      statement.run(
        setId,
        decision.sourceId,
        decision.outcome,
        ` ${(decision.labels ?? []).join(' ')} `,
        decision.score ?? null,
        JSON.stringify(decision.detail ?? {}),
        decision.model ?? null,
        at,
      )
    }
    bumpRevision(db, setId)
  })
}

// -- evaluation -----------------------------------------------------------

interface Fresh {
  key: string
  count: number
}

const READS_CORPUS: ReadonlySet<Op> = new Set<Op>(['seed', 'rule_filter'])

/** The set whose members an AI node judges (its base parent). */
export function judgedParent(db: DatabaseSync, set: SetRow): SetRow {
  const edge = edgesOf(db, set.id).find(candidate => candidate.role === 'base')
  const parent = edge === undefined ? undefined : getSet(db, edge.parentId)
  if (parent === undefined) throw new Error(`set ${set.code} has lost its parent`)
  return parent
}

function rebuild(db: DatabaseSync, set: SetRow, edges: readonly EdgeRow[]): void {
  db.prepare('DELETE FROM set_members WHERE set_id = ?').run(set.id)
  const base = edges.find(edge => edge.role === 'base')?.parentId

  if (set.op === 'seed') {
    const ids = (set.params as unknown as SeedParams).ids
    const exists = db.prepare('SELECT 1 AS hit FROM papers WHERE source_id = ?')
    const insert = db.prepare('INSERT INTO set_members (set_id, position, source_id) VALUES (?, ?, ?)')
    let position = 0
    for (const id of ids) {
      if (exists.get(id) !== undefined) insert.run(set.id, position++, id)
    }
    return
  }

  if (set.op === 'rule_filter') {
    const params = set.params as unknown as RuleParams
    const compiled = compileRules([...scopeRules(params.scope), ...params.rules])
    const clauses = [...compiled.clauses]
    const values: SQLInputValue[] = [set.id, ...compiled.params]
    if (base !== undefined) {
      clauses.push('p.source_id IN (SELECT source_id FROM set_members WHERE set_id = ?)')
      values.push(base)
    }
    db.prepare(`
      INSERT INTO set_members (set_id, position, source_id)
      SELECT ?, row_number() OVER (ORDER BY p.published_at DESC NULLS LAST, p.source_id) - 1, p.source_id
      FROM papers p
      ${clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`}
    `).run(...values)
    return
  }

  if (set.op === 'union') {
    db.prepare(`
      INSERT INTO set_members (set_id, position, source_id)
      SELECT ?, row_number() OVER (ORDER BY rank) - 1, source_id FROM (
        SELECT m.source_id, min(e.position * 1000000000 + m.position) AS rank
        FROM set_edges e JOIN set_members m ON m.set_id = e.parent_id
        WHERE e.set_id = ? AND e.role = 'union'
        GROUP BY m.source_id
      )
    `).run(set.id, set.id)
    return
  }

  if (set.op === 'subtract') {
    const remove = edges.find(edge => edge.role === 'remove')?.parentId
    db.prepare(`
      INSERT INTO set_members (set_id, position, source_id)
      SELECT ?, row_number() OVER (ORDER BY m.position) - 1, m.source_id
      FROM set_members m
      WHERE m.set_id = ? AND m.source_id NOT IN (SELECT source_id FROM set_members WHERE set_id = ?)
    `).run(set.id, base ?? '', remove ?? '')
    return
  }

  if (set.op === 'ai_filter') {
    db.prepare(`
      INSERT INTO set_members (set_id, position, source_id)
      SELECT ?, row_number() OVER (ORDER BY m.position) - 1, m.source_id
      FROM set_members m
      JOIN set_decisions d ON d.set_id = ? AND d.source_id = m.source_id AND d.outcome = 'include'
      WHERE m.set_id = ?
    `).run(set.id, set.id, base ?? '')
    return
  }

  if (set.op === 'ai_classifier') {
    db.prepare(`
      INSERT INTO set_members (set_id, position, source_id)
      SELECT ?, position, source_id FROM set_members WHERE set_id = ?
    `).run(set.id, base ?? '')
    return
  }

  // classification_output: the classifier's papers carrying this label.
  const key = (set.params as unknown as OutputParams).category
  db.prepare(`
    INSERT INTO set_members (set_id, position, source_id)
    SELECT ?, row_number() OVER (ORDER BY m.position) - 1, m.source_id
    FROM set_members m
    JOIN set_decisions d ON d.set_id = m.set_id AND d.source_id = m.source_id AND instr(d.labels, ?) > 0
    WHERE m.set_id = ?
  `).run(set.id, ` ${key} `, base ?? '')
}

/**
 * Make a set's memoized members current and return its size. Parents are
 * refreshed first; an unchanged cache key costs one lookup per ancestor.
 */
export function ensureFresh(db: DatabaseSync, set: SetRow, memo = new Map<string, Fresh>()): Fresh {
  const known = memo.get(set.id)
  if (known !== undefined) return known

  const edges = edgesOf(db, set.id)
  const parentKeys = edges.map((edge) => {
    const parent = getSet(db, edge.parentId)
    if (parent === undefined) throw new Error(`set ${set.code} has lost a parent`)
    return `${edge.role}:${ensureFresh(db, parent, memo).key}`
  })
  const key = createHash('sha256').update(JSON.stringify([
    set.op,
    set.params,
    set.revision,
    parentKeys,
    READS_CORPUS.has(set.op) ? getLibraryVersion(db) : null,
  ])).digest('hex').slice(0, 32)

  const cached = db.prepare('SELECT cache_key, count FROM set_cache WHERE set_id = ?').get(set.id) as { cache_key: string, count: number } | undefined
  if (cached !== undefined && cached.cache_key === key) {
    const fresh = { key, count: Number(cached.count) }
    memo.set(set.id, fresh)
    return fresh
  }

  const count = atomically(db, () => {
    rebuild(db, set, edges)
    const total = Number((db.prepare('SELECT count(*) AS n FROM set_members WHERE set_id = ?').get(set.id) as { n: number }).n)
    if (total > MAX_MEMBERS) {
      throw new Error(`set ${set.code} would hold ${total.toLocaleString('en-US')} papers (limit ${MAX_MEMBERS.toLocaleString('en-US')}); narrow the scope or rules`)
    }
    db.prepare(`
      INSERT INTO set_cache (set_id, cache_key, count, built_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(set_id) DO UPDATE SET cache_key = excluded.cache_key, count = excluded.count, built_at = excluded.built_at
    `).run(set.id, key, total, now())
    return total
  })
  const fresh = { key, count }
  memo.set(set.id, fresh)
  return fresh
}

// -- reads ----------------------------------------------------------------

export interface MemberPaper {
  sourceId: string
  title: string
  authors: string
  publishedAt: string | null
  primaryCategory: string
  categories: string
  absUrl: string
  pdfUrl: string
  abstract: string
  decision?: {
    outcome: string
    labels: string[]
    score: number | null
    detail: Record<string, unknown>
  }
}

export type MemberStatus = 'member' | 'excluded' | 'undecided' | 'other' | 'uncertain' | 'unassigned'

const MEMBER_COLUMNS = `
  p.source_id AS sourceId, p.title, p.authors, p.published_at AS publishedAt,
  p.primary_category AS primaryCategory, p.categories, p.abs_url AS absUrl,
  p.pdf_url AS pdfUrl, p.abstract,
  d.outcome AS d_outcome, d.labels AS d_labels, d.score AS d_score, d.detail AS d_detail
`

function toMember(row: Record<string, unknown>): MemberPaper {
  const paper: MemberPaper = {
    sourceId: String(row.sourceId),
    title: String(row.title),
    authors: String(row.authors),
    publishedAt: row.publishedAt === null ? null : String(row.publishedAt),
    primaryCategory: String(row.primaryCategory),
    categories: String(row.categories),
    absUrl: String(row.absUrl),
    pdfUrl: String(row.pdfUrl),
    abstract: String(row.abstract),
  }
  if (row.d_outcome !== null && row.d_outcome !== undefined) {
    paper.decision = {
      outcome: String(row.d_outcome),
      labels: String(row.d_labels).trim().split(' ').filter(Boolean),
      score: row.d_score === null ? null : Number(row.d_score),
      detail: JSON.parse(String(row.d_detail)) as Record<string, unknown>,
    }
  }
  return paper
}

/** Which statuses a node can list. */
export function statusesOf(op: Op): MemberStatus[] {
  if (op === 'ai_filter') return ['member', 'excluded', 'undecided']
  if (op === 'ai_classifier') return ['member', 'undecided', 'other', 'uncertain', 'unassigned']
  return ['member']
}

export interface MemberPage {
  /** Cache generation the page was read from; a changed key means the set was re-evaluated. */
  key: string
  total: number
  offset: number
  papers: MemberPaper[]
}

/**
 * One page of a set's papers. `member` reads the set itself; the other
 * statuses read an AI node's candidates (its parent's members) by judgement.
 */
export function listMembers(
  db: DatabaseSync,
  set: SetRow,
  options: { status?: MemberStatus, offset?: number, limit?: number } = {},
): MemberPage {
  const status = options.status ?? 'member'
  if (!statusesOf(set.op).includes(status)) {
    throw new Error(`status "${status}" does not apply to a ${set.op} set (use ${statusesOf(set.op).join(', ')})`)
  }
  const fresh = ensureFresh(db, set)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100)

  // AI nodes are judged over their candidates: the filter's parent, or the classifier itself.
  const decisionSet = set.op === 'classification_output' ? judgedParent(db, set).id : set.id
  const pool = set.op === 'ai_filter' && status !== 'member' ? judgedParent(db, set).id : set.id
  const where: Record<MemberStatus, string> = {
    member: '1',
    excluded: "d.outcome = 'exclude'",
    undecided: 'd.source_id IS NULL',
    other: "d.outcome = 'other'",
    uncertain: "d.outcome = 'uncertain'",
    // The "unassigned" group: no category reached its acceptance bar.
    unassigned: "d.outcome IN ('other', 'uncertain')",
  }
  const from = `
    FROM set_members m
    JOIN papers p ON p.source_id = m.source_id
    LEFT JOIN set_decisions d ON d.set_id = ? AND d.source_id = m.source_id
    WHERE m.set_id = ? AND ${where[status]}
  `
  const total = Number((db.prepare(`SELECT count(*) AS n ${from}`).get(decisionSet, pool) as { n: number }).n)
  const rows = db.prepare(`SELECT ${MEMBER_COLUMNS} ${from} ORDER BY m.position LIMIT ? OFFSET ?`)
    .all(decisionSet, pool, limit, offset) as Array<Record<string, unknown>>
  return { key: fresh.key, total, offset, papers: rows.map(toMember) }
}

/** Candidates of an AI node still without a judgement, in candidate order. */
export function undecidedIds(db: DatabaseSync, set: SetRow, limit?: number): string[] {
  const pool = set.op === 'ai_filter' ? judgedParent(db, set) : set
  ensureFresh(db, pool)
  const rows = db.prepare(`
    SELECT m.source_id AS id FROM set_members m
    WHERE m.set_id = ? AND NOT EXISTS (SELECT 1 FROM set_decisions d WHERE d.set_id = ? AND d.source_id = m.source_id)
    ORDER BY m.position
    ${limit === undefined ? '' : 'LIMIT ?'}
  `).all(...(limit === undefined ? [pool.id, set.id] : [pool.id, set.id, limit])) as Array<{ id: string }>
  return rows.map(row => row.id)
}

// -- node views -----------------------------------------------------------

export interface JobView {
  id: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled'
  total: number
  judged: number
  requests: number
  lastError: string | null
  createdAt: string
  finishedAt: string | null
}

export interface NodeView {
  id: string
  code: string
  name: string
  op: Op
  createdAt: string
  count: number
  /** Evaluation error (e.g. too many members); count is then 0. */
  error?: string
  parents: Array<{ code: string, role: EdgeRole }>
  /** Human-readable definition lines (rules, scope, seed size, criteria…), in English for the model. */
  summary: string[]
  /** The operator parameters, for clients that render the definition themselves. */
  definition: Record<string, unknown>
  /** rule_filter without a parent: the scope its virtual corpus root shows. */
  universe?: string
  /** AI nodes. */
  judged?: number
  undecided?: number
  excluded?: number
  criteria?: string
  mode?: 'single_label' | 'multi_label'
  model?: string
  classes?: Array<{ key: string, name: string, count: number }>
  other?: number
  uncertain?: number
  job?: JobView
}

function count(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  return Number((db.prepare(sql).get(...params) as { n: number }).n)
}

export function latestJobOf(db: DatabaseSync, setId: string): JobView | undefined {
  const row = db.prepare('SELECT * FROM judge_jobs WHERE set_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(setId) as Record<string, unknown> | undefined
  if (row === undefined) return undefined
  return {
    id: String(row.id),
    status: row.status as JobView['status'],
    total: Number(row.total),
    judged: Number(row.judged),
    requests: Number(row.requests),
    lastError: row.last_error === null ? null : String(row.last_error),
    createdAt: String(row.created_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
  }
}

export function nodeView(db: DatabaseSync, set: SetRow, memo = new Map<string, Fresh>()): NodeView {
  const edges = edgesOf(db, set.id)
  const view: NodeView = {
    id: set.id,
    code: set.code,
    name: set.name,
    op: set.op,
    createdAt: set.createdAt,
    count: 0,
    parents: edges.map(edge => ({ code: getSet(db, edge.parentId)?.code ?? '?', role: edge.role })),
    summary: [],
    definition: set.params,
  }
  try {
    view.count = ensureFresh(db, set, memo).count
  } catch (error) {
    view.error = error instanceof Error ? error.message : String(error)
  }

  if (set.op === 'seed') {
    const ids = (set.params as unknown as SeedParams).ids
    view.summary.push(`${ids.length} named paper id(s)${view.count < ids.length ? `, ${ids.length - view.count} not in the local corpus` : ''}`)
  } else if (set.op === 'rule_filter') {
    const params = set.params as unknown as RuleParams
    if (edges.length === 0) view.universe = describeScope(params.scope)
    else if (params.scope !== undefined) view.summary.push(describeScope(params.scope))
    view.summary.push(...params.rules.map(describeRule))
    if (params.rules.length === 0 && edges.length === 0) view.summary.push('all papers in scope')
  } else if (set.op === 'union') {
    view.summary.push(`union of ${edges.length} sets`)
  } else if (set.op === 'subtract') {
    view.summary.push('base minus remove')
  } else if (set.op === 'ai_filter' || set.op === 'ai_classifier') {
    const params = set.params as unknown as FilterParams & ClassifierParams
    const pool = set.op === 'ai_filter' ? judgedParent(db, set).id : set.id
    if (view.error === undefined) {
      const candidates = set.op === 'ai_filter' ? ensureFresh(db, judgedParent(db, set), memo).count : view.count
      view.judged = count(db, `
        SELECT count(*) AS n FROM set_members m JOIN set_decisions d ON d.set_id = ? AND d.source_id = m.source_id
        WHERE m.set_id = ?
      `, set.id, pool)
      view.undecided = candidates - view.judged
    }
    view.model = params.model
    view.job = latestJobOf(db, set.id)
    if (set.op === 'ai_filter') {
      view.criteria = params.criteria
      view.summary.push(`Jev screening (include at p ≥ ${params.thresholds.noul})`)
      if (view.error === undefined) {
        view.excluded = count(db, `
          SELECT count(*) AS n FROM set_members m JOIN set_decisions d ON d.set_id = ? AND d.source_id = m.source_id AND d.outcome = 'exclude'
          WHERE m.set_id = ?
        `, set.id, pool)
      }
    } else {
      view.mode = params.mode
      view.summary.push(`Jev classification, ${params.mode === 'single_label' ? 'one label per paper' : 'independent labels'}`)
      if (view.error === undefined) {
        view.classes = params.categories.map(category => ({
          key: category.key,
          name: category.name,
          count: count(db, `
            SELECT count(*) AS n FROM set_members m JOIN set_decisions d ON d.set_id = ? AND d.source_id = m.source_id AND instr(d.labels, ?) > 0
            WHERE m.set_id = ?
          `, set.id, ` ${category.key} `, set.id),
        }))
        const byOutcome = (outcome: string): number => count(db, `
          SELECT count(*) AS n FROM set_members m JOIN set_decisions d ON d.set_id = ? AND d.source_id = m.source_id AND d.outcome = ?
          WHERE m.set_id = ?
        `, set.id, outcome, set.id)
        view.other = byOutcome('other')
        view.uncertain = byOutcome('uncertain')
      }
      for (const category of params.categories) view.summary.push(`${category.key}: ${category.name}`)
    }
  } else {
    const key = (set.params as unknown as OutputParams).category
    const classifier = judgedParent(db, set)
    const category = (classifier.params as unknown as ClassifierParams).categories.find(item => item.key === key)
    view.summary.push(`label ${key}${category === undefined ? '' : `: ${category.criteria}`}`)
    view.job = latestJobOf(db, classifier.id)
  }
  return view
}

export interface FlowGraph {
  flow: FlowRow
  nodes: NodeView[]
}

export function flowGraph(db: DatabaseSync, flow: FlowRow): FlowGraph {
  const memo = new Map<string, Fresh>()
  return { flow, nodes: setsOfFlow(db, flow.id).map(set => nodeView(db, set, memo)) }
}
