/**
 * Model-facing `parallax_set` tool: the conversation's set-building graph.
 *
 * One tool with an `action` keeps the always-on schema small, like `parallax`.
 * Free synchronous operators go through `create`; the paid asynchronous Jev
 * operators are `judge` and `classify`, calibrated first with `trial`. Every
 * conversation owns one flow; subagents write into their root conversation's
 * flow, so batch work shows up on the same graph.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { startDshJob, type DshJobRegistry } from '../dsh-jobs.ts'
import { rootSession, TEXT_OUTPUT, type ToolExec, type ToolRegistry } from '../host.ts'
import { getCategories, publishedCompleteness, type PublishedCompleteness } from '../ingest/db.ts'
import { clampedInt, clipAbstract, normalizeArxivId, optionalString, parseAction, requiredString } from '../tool-args.ts'
import type { FlowEvents } from './events.ts'
import { exportFileName, exportSet } from './export.ts'
import { isActive, judgingNode, MAX_JUDGE_CANDIDATES, MAX_TRIAL, type JudgeService } from './jobs.ts'
import { compileRules, describeRule, describeScope, parseRules, parseScope, scopeRules, type Rule, type Scope } from './rules.ts'
import {
  atomically,
  childrenOf,
  DEFAULT_THRESHOLDS,
  ensureFlow,
  ensureFresh,
  flowForSession,
  flowGraph,
  insertSet,
  listMembers,
  nodeView,
  resolveSet,
  setsOfFlow,
  statusesOf,
  touchFlow,
  type Category,
  type EdgeRole,
  type FlowRow,
  type JobView,
  type MemberStatus,
  type NodeView,
  type Op,
  type SetRow,
} from './store.ts'

const ACTIONS = ['inspect', 'probe', 'create', 'trial', 'judge', 'classify', 'resume', 'cancel', 'wait', 'members', 'export'] as const
type Action = (typeof ACTIONS)[number]
const READ_ONLY: ReadonlySet<string> = new Set(['inspect', 'probe', 'members', 'wait', 'trial'])
const ID_RE = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/
const KEY_RE = /^[a-z][a-z0-9_]*$/
const MAX_SEED_IDS = 500
const MAX_UNION_PARENTS = 32
const MAX_CRITERIA_CHARS = 4000
const ABSTRACT_CHARS = 700
/** members page cap with `full_abstract`. */
const FULL_PAGE = 10
/** Ids listed in a trial's ready-made follow-up call. */
const REVIEW_IDS = 20

/** Appended when AI screening ends on a set nobody has classified yet. */
const CLASSIFY_OFFER = 'Next: after reviewing, ask the user (ask_user_question) whether to group the screened set with AI classification, proposing 2–4 concrete groupings drawn from the kept papers (e.g. method family, task, evidence type) plus a "no grouping" option. Classify only on their yes.'

/** Whether a screened set already feeds an AI classification node. */
function classified(db: DatabaseSync, set: SetRow): boolean {
  return childrenOf(db, set.id).some(child => child.op === 'ai_classifier')
}

function parseSetCodes(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${name} must be an array of set codes`)
  return value as string[]
}

function parseSeedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SEED_IDS || value.some(id => typeof id !== 'string')) {
    throw new Error(`op=seed needs ids: 1–${MAX_SEED_IDS} arXiv ids`)
  }
  const ids = [...new Set((value as string[]).map(normalizeArxivId))]
  const bad = ids.filter(id => !ID_RE.test(id))
  if (bad.length > 0) throw new Error(`not arXiv ids: ${bad.slice(0, 5).join(', ')}`)
  return ids
}

function parseCategories(value: unknown): Category[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) throw new Error('categories must list 2–12 categories')
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object') throw new Error(`categories[${index}] must be an object`)
    const raw = item as Record<string, unknown>
    const key = requiredString(raw.key, `categories[${index}].key`)
    const name = requiredString(raw.name, `categories[${index}].name`)
    const criteria = requiredString(raw.criteria, `categories[${index}].criteria`)
    if (!KEY_RE.test(key) || key.length > 40) throw new Error(`categories[${index}].key must match ^[a-z][a-z0-9_]*$ (≤40 chars)`)
    if (key === 'other' || key === 'uncertain') throw new Error('category keys "other" and "uncertain" are reserved')
    if (seen.has(key)) throw new Error(`duplicate category key "${key}"`)
    seen.add(key)
    if ([...name].length > 120) throw new Error(`categories[${index}].name must be at most 120 characters`)
    if ([...criteria].length > 3000) throw new Error(`categories[${index}].criteria must be at most 3000 characters`)
    return { key, name, criteria }
  })
}

// -- formatting -----------------------------------------------------------

const OP_LABEL: Record<Op, string> = {
  seed: 'seed',
  rule_filter: 'rule filter',
  union: 'union',
  subtract: 'subtract',
  ai_filter: 'AI screening (Jev)',
  ai_classifier: 'AI classification (Jev)',
  classification_output: 'classification output',
}

function formatNode(view: NodeView): string {
  const parents = view.parents.length === 0
    ? (view.universe === undefined ? '' : ` ← corpus [${view.universe}]`)
    : ` ← ${view.parents.map(parent => parent.role === 'base' ? parent.code : `${parent.role}:${parent.code}`).join(', ')}`
  const lines = [`- ${view.name} (${view.code}) · ${OP_LABEL[view.op]} · ${view.error === undefined ? `${view.count.toLocaleString('en-US')} papers` : `error: ${view.error}`}${parents}`]
  for (const line of view.summary) lines.push(`    ${line}`)
  if (view.criteria !== undefined) lines.push(`    criteria: ${view.criteria}`)
  if (view.judged !== undefined) {
    lines.push(`    judged ${view.judged}, undecided ${view.undecided ?? 0}${view.excluded === undefined ? '' : `, excluded ${view.excluded}`}${view.other === undefined ? '' : `, other ${view.other}, uncertain ${view.uncertain ?? 0}`}`)
  }
  if (view.classes !== undefined) lines.push(`    labels: ${view.classes.map(item => `${item.key} ${item.count}`).join(' · ')}`)
  if (view.job !== undefined && (view.op === 'ai_filter' || view.op === 'ai_classifier')) {
    const job = view.job
    lines.push(`    job ${job.status}: ${job.judged}/${job.total}${job.lastError === null ? '' : ` — ${job.lastError}`}`)
  }
  return lines.join('\n')
}

/** A judging node and its classification outputs, one block each. */
function formatJudging(db: DatabaseSync, set: SetRow): string[] {
  const outputs = childrenOf(db, set.id).filter(child => child.op === 'classification_output')
  return [set, ...outputs].map(node => formatNode(nodeView(db, node)))
}

function inspectText(db: DatabaseSync, flow: FlowRow): string {
  const graph = flowGraph(db, flow)
  return [`Flow "${flow.name}": ${graph.nodes.length} set(s). Codes are the only valid references.`, ...graph.nodes.map(formatNode)].join('\n')
}

/** A warning when a rule filter's date window reaches past what the harvest covers completely. */
function completenessNote(scope: Scope | undefined, rules: readonly Rule[], completeness: PublishedCompleteness): string | undefined {
  let from = scope?.from
  let to = scope?.to
  for (const rule of rules) {
    if (rule.type !== 'time_window') continue
    if (rule.from !== undefined && (from === undefined || rule.from > from)) from = rule.from
    if (rule.to !== undefined && (to === undefined || rule.to < to)) to = rule.to
  }
  const { since, through } = completeness
  if (since === null || through === null) {
    return 'Coverage: no submission-date range is complete in the local corpus; treat any count as partial.'
  }
  if (from === undefined || from < since || to === undefined || to > through) {
    return `Coverage: only submissions ${since}..${through} are complete locally; the part of this window outside it is partial.`
  }
  return undefined
}

function probe(db: DatabaseSync, parent: SetRow | undefined, scope: Scope | undefined, rules: Rule[]): string {
  const compiled = compileRules([...scopeRules(scope), ...rules])
  const clauses = [...compiled.clauses]
  const params: SQLInputValue[] = [...compiled.params]
  if (parent !== undefined) {
    ensureFresh(db, parent)
    clauses.push('p.source_id IN (SELECT source_id FROM set_members WHERE set_id = ?)')
    params.push(parent.id)
  }
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
  const total = Number((db.prepare(`SELECT count(*) AS n FROM papers p ${where}`).get(...params) as { n: number }).n)
  const years = db.prepare(`SELECT substr(p.published_at, 1, 4) AS year, count(*) AS n FROM papers p ${where} GROUP BY year ORDER BY year DESC LIMIT 12`)
    .all(...params) as Array<{ year: string | null, n: number }>
  const primary = db.prepare(`SELECT p.primary_category AS category, count(*) AS n FROM papers p ${where} GROUP BY category ORDER BY n DESC LIMIT 8`)
    .all(...params) as Array<{ category: string, n: number }>
  const sample = (order: string, limit: number): string[] =>
    (db.prepare(`SELECT p.source_id AS id, p.title, substr(p.published_at, 1, 10) AS date FROM papers p ${where} ORDER BY ${order} LIMIT ?`)
      .all(...params, limit) as Array<{ id: string, title: string, date: string | null }>)
      .map(row => `  [${row.id}] ${row.title} (${row.date ?? '?'})`)

  const definition = [
    parent === undefined ? `corpus [${describeScope(scope)}]` : `within ${parent.name} (${parent.code})${scope === undefined ? '' : `; ${describeScope(scope)}`}`,
    ...rules.map(describeRule),
  ].join('; ')
  const lines = [`Probe (free, nothing stored): ${definition}`, `Matches: ${total.toLocaleString('en-US')} papers.`]
  if (total > 0) {
    lines.push(`By year: ${years.map(row => `${row.year ?? 'undated'} ${row.n}`).join(' · ')}`)
    lines.push(`By primary category: ${primary.map(row => `${row.category || '?'} ${row.n}`).join(' · ')}`)
    lines.push('Newest:', ...sample('p.published_at DESC NULLS LAST, p.source_id', 5))
    if (total > 5) lines.push('Oldest:', ...sample('p.published_at ASC NULLS LAST, p.source_id', 3))
  }
  const note = completenessNote(scope, rules, publishedCompleteness(db, getCategories(db)))
  if (note !== undefined) lines.push(note)
  return lines.join('\n')
}

// -- schema ---------------------------------------------------------------

const RULE_SCHEMA = {
  type: 'object',
  description: 'One rule; rules are ANDed. time_window {from?, to?} filters the v1 submission date (YYYY-MM-DD). category {categories, primary_only?} takes exact codes (cs.LG) or a group wildcard (cs.*). keyword {terms, fields?, match?, mode?}: fields ⊆ title|abstract|author|source_id (default title+abstract); match any|all (default any); mode literal = case-insensitive substring (default), wildcard = whole words with an optional * at either end of a 3–64 letter/digit stem (e.g. "diffus*").',
  properties: {
    type: { type: 'string', enum: ['time_window', 'category', 'keyword'] },
    from: { type: 'string' },
    to: { type: 'string' },
    categories: { type: 'array', items: { type: 'string' } },
    primary_only: { type: 'boolean' },
    terms: { type: 'array', items: { type: 'string' } },
    fields: { type: 'array', items: { type: 'string', enum: ['title', 'abstract', 'author', 'source_id'] } },
    match: { type: 'string', enum: ['any', 'all'] },
    mode: { type: 'string', enum: ['literal', 'wildcard'] },
  },
  required: ['type'],
}

const DESCRIPTION = [
  "Build and read this conversation's Parallax set graph over the local arXiv corpus. Sets are immutable nodes referenced by 8-letter codes; every change is a new node, so the graph shows how a collection was built.",
  'action=inspect lists every node with its code, operator, size and judging progress. action=probe dry-runs a rule filter (count, year/category distribution, samples; free, stores nothing). action=create makes a free node: op=seed (ids: arXiv ids), op=rule_filter (parent? + scope? + rules), op=union (parents: 2–32 codes), op=subtract (base minus remove).',
  'AI operators run on the Jev judge model and cost the user money: always action=trial first (judges a small sample of a parent against criteria, stores nothing), then action=judge (screening: keeps papers that meet criteria; Jev gives probabilities, not reasons) or action=classify (2–12 categories, single_label or multi_label; one output node per category). Both return at once and judge in the background, registered as a host background job when available (you are then notified when it ends); action=wait blocks until judging finishes (fallback without background jobs), action=resume judges candidates added since, action=cancel stops a run.',
  'action=members pages a node (status member|excluded|undecided|other|uncertain, with abstracts). action=export writes the papers of a set into the workspace as a JSON array, one metadata item per paper. Papers outside the harvested days are not in the corpus.',
].join(' ')

const PARAMETERS = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...ACTIONS] },
    name: { type: 'string', description: 'Name of the new node (create/judge/classify), ≤120 chars, in the user\'s language.' },
    op: { type: 'string', enum: ['seed', 'rule_filter', 'union', 'subtract'], description: 'Operator for action=create.' },
    parent: { type: 'string', description: 'Parent set code: rule_filter (optional; omit to filter the whole corpus), probe, trial, judge, classify.' },
    parents: { type: 'array', items: { type: 'string' }, description: `op=union: 2–${MAX_UNION_PARENTS} set codes, in order.` },
    base: { type: 'string', description: 'op=subtract: set to subtract from.' },
    remove: { type: 'string', description: 'op=subtract: set whose papers are removed.' },
    ids: { type: 'array', items: { type: 'string' }, description: `op=seed: 1–${MAX_SEED_IDS} arXiv ids (2401.01234; prefix/version tolerated).` },
    scope: {
      type: 'object',
      description: 'rule_filter/probe corpus scope: {from?, to?: YYYY-MM-DD submission dates, categories?: codes or group.*}.',
      properties: { from: { type: 'string' }, to: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } } },
    },
    rules: { type: 'array', items: RULE_SCHEMA, description: 'rule_filter/probe rules, ANDed.' },
    criteria: { type: 'string', description: 'trial/judge: inclusion criteria in plain language — what a paper must be or do to be kept, and explicit exclusions. Pass the exact text you trialled.' },
    categories: {
      type: 'array',
      description: 'classify: 2–12 categories {key: ^[a-z][a-z0-9_]*$, name, criteria}; "other" and "uncertain" are reserved.',
      items: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, criteria: { type: 'string' } }, required: ['key', 'name', 'criteria'] },
    },
    mode: { type: 'string', enum: ['single_label', 'multi_label'], description: 'classify: one label per paper, or independent labels.' },
    set: { type: 'string', description: 'Target set code: members, resume, cancel, export, wait (wait defaults to every judging node).' },
    status: { type: 'string', enum: ['member', 'excluded', 'undecided', 'other', 'uncertain', 'unassigned'], description: 'members: which papers to list (default member).' },
    offset: { type: 'number', description: 'members: start position (default 0).' },
    limit: { type: 'number', description: `members: page size 1–50 (default 20; 1–${FULL_PAGE} with full_abstract).` },
    full_abstract: { type: 'boolean', description: `members: untrimmed abstracts (page size ≤${FULL_PAGE}). Default pages trim abstracts to ~${ABSTRACT_CHARS} chars and mark the cut.` },
    sample_size: { type: 'number', description: `trial: papers to judge, 1–${MAX_TRIAL} (default 20), spread evenly over the parent.` },
    timeout_seconds: { type: 'number', description: 'wait: give up after this many seconds (default 300, max 1800).' },
  },
  required: ['action'],
  additionalProperties: false,
}

// -- actions --------------------------------------------------------------

/** What every action (except `inspect`) works with. */
interface ActionContext {
  db: DatabaseSync
  judges: JudgeService
  events?: FlowEvents
  args: Record<string, unknown>
  exec: ToolExec
  sessionId: string
  cwd?: string
  flow: FlowRow
  /** Resolve a set code of this flow, naming the argument on failure. */
  find: (ref: unknown, name: string) => SetRow
  /** Register a queued run as a host job; undefined without a job registry. */
  registerJudging: (exec: ToolExec, node: SetRow) => string | undefined
}

type Handler = (context: ActionContext) => Promise<string> | string

/** The node a free operator creates, before it is inserted. */
function freeNode(context: ActionContext, op: Op): { params: Record<string, unknown>, parents: Array<{ id: string, role: EdgeRole }> } {
  const { args, find } = context
  if (op === 'seed') return { params: { ids: parseSeedIds(args.ids) }, parents: [] }
  if (op === 'rule_filter') {
    const scope = parseScope(args.scope)
    return {
      params: { ...scope === undefined ? {} : { scope }, rules: parseRules(args.rules) },
      parents: args.parent === undefined ? [] : [{ id: find(args.parent, 'parent').id, role: 'base' }],
    }
  }
  if (op === 'union') {
    const codes = parseSetCodes(args.parents, 'parents')
    if (codes.length < 2 || codes.length > MAX_UNION_PARENTS) throw new Error(`op=union needs 2–${MAX_UNION_PARENTS} parents`)
    const ids = codes.map((code, index) => find(code, `parents[${index}]`).id)
    if (new Set(ids).size !== ids.length) throw new Error('op=union parents must be distinct')
    return { params: {}, parents: ids.map(id => ({ id, role: 'union' as const })) }
  }
  if (op === 'subtract') {
    const base = find(args.base, 'base')
    const remove = find(args.remove, 'remove')
    if (base.id === remove.id) throw new Error('base and remove must be different sets')
    return { params: {}, parents: [{ id: base.id, role: 'base' }, { id: remove.id, role: 'remove' }] }
  }
  throw new Error('op must be seed, rule_filter, union or subtract (AI operators are action=judge / action=classify)')
}

const create: Handler = (context) => {
  const { db, events, args, sessionId, flow } = context
  const name = requiredString(args.name, 'name')
  const op = requiredString(args.op, 'op') as Op
  const { params, parents } = freeNode(context, op)
  const first = setsOfFlow(db, flow.id).length === 0
  // Evaluate before committing: a node that cannot be built is never left in the graph.
  const set = atomically(db, () => {
    const created = insertSet(db, flow.id, { name, op, params, parents })
    ensureFresh(db, created)
    return created
  })
  // The first node starts the conversation's graph: the client opens the canvas.
  if (first) events?.publish({ type: 'flow-started', sessionId, flowId: flow.id })
  const view = nodeView(db, set)
  const notes = [`Created ${set.name} (${set.code}).`, formatNode(view)]
  if (op === 'seed' && view.count < (params.ids as string[]).length) {
    notes.push('Ids missing from the local corpus are dropped; check them with web_search or harvest their days.')
  }
  if (op === 'rule_filter') {
    const note = completenessNote(params.scope as Scope | undefined, params.rules as Rule[], publishedCompleteness(db, getCategories(db)))
    if (note !== undefined) notes.push(note)
  }
  return notes.join('\n')
}

const trial: Handler = async ({ judges, args, exec, find }) => {
  const parent = find(args.parent, 'parent')
  const criteria = requiredString(args.criteria, 'criteria')
  const runtime = await judges.requireRuntime()
  const result = await judges.trial(parent, criteria, clampedInt(args.sample_size, 'sample_size', 20, 1, MAX_TRIAL), runtime.model, DEFAULT_THRESHOLDS, exec.signal)
  const rate = result.sample === 0 ? 0 : result.included / result.sample
  // Borderline (0.3–0.7) first, nearest the threshold first; otherwise the closest few.
  const byMargin = [...result.papers].sort((a, b) => Math.abs(a.score - 0.5) - Math.abs(b.score - 0.5))
  const borderline = byMargin.filter(paper => paper.score >= 0.3 && paper.score <= 0.7)
  const review = (borderline.length > 0 ? borderline : byMargin.slice(0, 5)).slice(0, REVIEW_IDS).map(paper => paper.sourceId)
  return [
    `Trial on ${parent.name} (${parent.code}): ${result.included}/${result.sample} kept (${Math.round(rate * 100)}%) at p ≥ ${DEFAULT_THRESHOLDS.noul}; nothing stored.`,
    `Projected if judged in full: ~${Math.round(rate * result.candidates).toLocaleString('en-US')} of ${result.candidates.toLocaleString('en-US')} kept. ${result.requests} request(s), ${result.inputTokens.toLocaleString('en-US')} input tokens for the sample.`,
    'Scores (highest first) — read the abstracts of borderline and surprising ones before committing:',
    ...result.papers.map(paper => `  ${paper.include ? '✓' : '✗'} ${paper.score.toFixed(2)} [${paper.sourceId}] ${paper.title}`),
    ...review.length === 0 ? [] : [
      `Full abstracts of the ${borderline.length > 0 ? 'borderline' : 'closest-to-threshold'} papers: parallax({ action: "paper", ids: ${JSON.stringify(review)} }) — add any surprising ✓/✗ ids.`,
    ],
  ].join('\n')
}

/** `judge` and `classify`: insert the AI node (and its outputs) and queue the run. */
function startJudging(op: 'ai_filter' | 'ai_classifier'): Handler {
  return async ({ db, judges, args, exec, flow, find, registerJudging }) => {
    const name = requiredString(args.name, 'name')
    const parent = find(args.parent, 'parent')
    const runtime = await judges.requireRuntime()
    const candidates = ensureFresh(db, parent).count
    if (candidates === 0) throw new Error(`set ${parent.code} is empty; there is nothing to judge`)
    if (candidates > MAX_JUDGE_CANDIDATES) {
      throw new Error(`${parent.code} has ${candidates.toLocaleString('en-US')} papers; one Jev run judges at most ${MAX_JUDGE_CANDIDATES.toLocaleString('en-US')}. Narrow it with rules first`)
    }
    const base = [{ id: parent.id, role: 'base' as const }]
    let node: SetRow
    if (op === 'ai_filter') {
      const criteria = requiredString(args.criteria, 'criteria')
      if ([...criteria].length > MAX_CRITERIA_CHARS) throw new Error(`criteria must be at most ${MAX_CRITERIA_CHARS} characters`)
      node = insertSet(db, flow.id, { name, op, params: { criteria, model: runtime.model, thresholds: DEFAULT_THRESHOLDS }, parents: base })
    } else {
      const categories = parseCategories(args.categories)
      const mode = requiredString(args.mode, 'mode')
      if (mode !== 'single_label' && mode !== 'multi_label') throw new Error('mode must be single_label or multi_label')
      node = atomically(db, () => {
        const classifier = insertSet(db, flow.id, { name, op, params: { categories, mode, model: runtime.model, thresholds: DEFAULT_THRESHOLDS }, parents: base })
        for (const category of categories) {
          insertSet(db, flow.id, { name: category.name, op: 'classification_output', params: { category: category.key }, parents: [{ id: classifier.id, role: 'base' }] })
        }
        return classifier
      })
    }
    const job = judges.enqueue(node)
    touchFlow(db, flow.id)
    const dshJob = job === undefined ? undefined : registerJudging(exec, node)
    const outputs = op === 'ai_classifier' ? childrenOf(db, node.id) : []
    return [
      `Created ${node.name} (${node.code}); Jev is judging ${(job?.total ?? 0).toLocaleString('en-US')} candidate(s) from ${parent.name} (${parent.code}) in the background.`,
      ...outputs.length === 0 ? [] : [`Output nodes: ${outputs.map(set => `${set.name} (${set.code})`).join(', ')}.`],
      dshJob === undefined
        ? 'Use action=wait to block until it finishes, or continue and check action=inspect.'
        : `It runs as background job ${dshJob}: you are notified in-session when it ends, so keep working on independent steps instead of calling action=wait.`,
    ].join('\n')
  }
}

/** The judging node behind `args.set`, or an error naming what the set is instead. */
function targetJudging({ db, args, find }: ActionContext): SetRow {
  const target = find(args.set, 'set')
  const judging = judgingNode(db, target)
  if (judging === undefined) throw new Error(`${target.code} is a ${target.op} set; only AI screening/classification nodes are judged`)
  return judging
}

const cancel: Handler = (context) => {
  const judging = targetJudging(context)
  return context.judges.cancel(judging.id)
    ? `Stopped judging ${judging.name} (${judging.code}); judgements already made are kept.`
    : `${judging.code} has no running job.`
}

const resume: Handler = async (context) => {
  const { judges, exec, registerJudging } = context
  const judging = targetJudging(context)
  await judges.requireRuntime()
  // A run already in flight belongs to whoever started it: register only a new one.
  const running = judges.busy(judging.id)
  const job = judges.enqueue(judging)
  if (job === undefined) return `${judging.name} (${judging.code}) has no undecided candidates.`
  const dshJob = running ? undefined : registerJudging(exec, judging)
  return [
    `Judging ${job.total - job.judged} undecided candidate(s) of ${judging.name} (${judging.code}) in the background.`,
    ...dshJob === undefined ? [] : [`It runs as background job ${dshJob}: you are notified in-session when it ends.`],
  ].join('\n')
}

const wait: Handler = async ({ db, judges, args, exec, flow, find }) => {
  const targets = args.set === undefined
    ? setsOfFlow(db, flow.id).filter(set => set.op === 'ai_filter' || set.op === 'ai_classifier')
    : [judgingNode(db, find(args.set, 'set'))].filter((set): set is SetRow => set !== undefined)
  if (targets.length === 0) return 'No judging nodes to wait for.'
  const timeout = clampedInt(args.timeout_seconds, 'timeout_seconds', 300, 1, 1800)
  const finished = await judges.waitFor(targets.map(set => set.id), timeout * 1000, exec.signal)
  const lines = [finished ? 'Judging finished.' : `Still judging after ${timeout}s; call wait again or continue.`]
  for (const set of targets) lines.push(...formatJudging(db, set))
  if (finished && targets.some(set => set.op === 'ai_filter' && !classified(db, set))) lines.push(CLASSIFY_OFFER)
  return lines.join('\n')
}

const members: Handler = ({ db, args, find }) => {
  const set = find(args.set, 'set')
  const status = (optionalString(args.status, 'status') ?? 'member') as MemberStatus
  if (!statusesOf(set.op).includes(status)) throw new Error(`status for a ${set.op} set must be one of ${statusesOf(set.op).join(', ')}`)
  // Full abstracts run ~1–2k characters each: a smaller page keeps the result readable.
  const full = args.full_abstract === true
  const page = listMembers(db, set, {
    status,
    offset: clampedInt(args.offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
    limit: clampedInt(args.limit, 'limit', full ? FULL_PAGE : 20, 1, full ? FULL_PAGE : 50),
  })
  const lines = [`${set.name} (${set.code}) · ${status}: ${page.total.toLocaleString('en-US')} paper(s); showing ${page.offset + 1}–${page.offset + page.papers.length}.`]
  page.papers.forEach((paper, index) => {
    const decision = paper.decision === undefined
      ? ''
      : ` · Jev ${paper.decision.outcome}${paper.decision.labels.length === 0 ? '' : ` [${paper.decision.labels.join(', ')}]`}${paper.decision.score === null ? '' : ` ${paper.decision.score.toFixed(2)}`}`
    const abstract = full ? paper.abstract.replace(/\s+/g, ' ').trim() : clipAbstract(paper.abstract, ABSTRACT_CHARS, 'full_abstract:true or parallax paper')
    lines.push(`${page.offset + index + 1}. [${paper.sourceId}] ${paper.title}`)
    lines.push(`   ${paper.authors || '(no authors)'} · ${paper.publishedAt?.slice(0, 10) ?? '?'} · ${paper.categories}${decision}`)
    lines.push(`   ${abstract}`)
  })
  if (page.offset + page.papers.length < page.total) lines.push(`More: offset=${page.offset + page.papers.length}.`)
  return lines.join('\n')
}

const exportAction: Handler = async ({ db, args, cwd, find }) => {
  const set = find(args.set, 'set')
  if (cwd === undefined) throw new Error('this session has no workspace directory to export into')
  const papers = exportSet(db, set)
  const directory = join(cwd, 'parallax', 'exports')
  await mkdir(directory, { recursive: true })
  const file = join(directory, exportFileName(set))
  await writeFile(file, `${JSON.stringify(papers, null, 2)}\n`, 'utf8')
  return `Exported ${set.name} (${set.code}): ${papers.length} paper(s), one metadata item each → ${file}`
}

const HANDLERS: Record<Exclude<Action, 'inspect'>, Handler> = {
  probe: ({ args, db, find }) => probe(db, args.parent === undefined ? undefined : find(args.parent, 'parent'), parseScope(args.scope), parseRules(args.rules)),
  create,
  trial,
  judge: startJudging('ai_filter'),
  classify: startJudging('ai_classifier'),
  resume,
  cancel,
  wait,
  members,
  export: exportAction,
}

/** The completion notice for a finished judging run. */
function judgingOutcome(db: DatabaseSync, node: SetRow, view: JobView | undefined): { status: 'completed' | 'killed' | 'failed', detail: string, summary: string } {
  const lines = formatJudging(db, node)
  if (view !== undefined && isActive(view)) {
    return { status: 'failed', detail: 'Parallax was unloaded; judging resumes on its own when it loads again', summary: lines.join('\n') }
  }
  if (view?.status === 'canceled') {
    return { status: 'killed', detail: `stopped after ${view.judged}/${view.total} judged; judgements made are kept, resume judges the rest`, summary: lines.join('\n') }
  }
  if (view?.status === 'failed') {
    return { status: 'failed', detail: view.lastError ?? 'Jev request failed', summary: [...lines, 'Judgements made are kept; resume judges the rest once the cause is fixed.'].join('\n') }
  }
  return {
    status: 'completed',
    detail: `${view?.judged ?? 0} judged`,
    summary: [
      ...lines,
      'Review borderline and consequential decisions with action=members before relying on them.',
      ...node.op === 'ai_filter' && !classified(db, node) ? [CLASSIFY_OFFER] : [],
    ].join('\n'),
  }
}

export function registerSetTool(
  tools: ToolRegistry,
  db: DatabaseSync,
  judges: JudgeService,
  events?: FlowEvents,
  /** Looked up per call: the registry may come and go with its plugin. */
  jobs: () => DshJobRegistry | undefined = () => undefined,
): void {
  /**
   * Register a judging run the model just queued as a host job owned by the
   * calling agent, so it is notified when the run ends. Cancelling the job
   * runs our own cancel. Undefined when there is no registry: fall back to wait.
   */
  const registerJudging = (exec: ToolExec, node: SetRow): string | undefined => startDshJob(jobs(), exec, {
    kind: 'parallax-judge',
    label: `Jev ${node.op === 'ai_classifier' ? 'classification' : 'screening'}: ${node.name} (${node.code})`,
    start: (job) => {
      const tracked = judges.track(node.id, (view) => {
        job.updateProgress(`${view.judged.toLocaleString('en-US')}/${view.total.toLocaleString('en-US')} judged · ${view.requests} requests`)
      })
      return {
        cancel: () => { judges.cancel(node.id) },
        done: tracked.done.then(view => judgingOutcome(db, node, view)),
      }
    },
  })

  tools.register({
    name: 'parallax_set',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: TEXT_OUTPUT,
    isConcurrencySafe: args => READ_ONLY.has(String((args as Record<string, unknown> | null)?.action)),
    async execute(args, exec): Promise<string> {
      exec.signal.throwIfAborted()
      const action = parseAction(args.action, ACTIONS)
      const { sessionId, cwd } = rootSession(exec.agent)

      if (action === 'inspect') {
        const flow = flowForSession(db, sessionId)
        if (flow === undefined || setsOfFlow(db, flow.id).length === 0) return 'This conversation has no sets yet. Start with action=probe, then action=create.'
        return inspectText(db, flow)
      }

      const flow = ensureFlow(db, sessionId)
      return await HANDLERS[action]({
        db,
        judges,
        events,
        args,
        exec,
        sessionId,
        ...cwd === undefined ? {} : { cwd },
        flow,
        find: (ref, name) => resolveSet(db, flow.id, ref, name),
        registerJudging,
      })
    },
  })
}
