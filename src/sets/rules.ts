/**
 * Rule grammar for `rule_filter` sets: what a keyword-only SQLite corpus can
 * answer (no embedding or citation rules):
 *
 *  - `time_window {from?, to?}` on the v1 submission date;
 *  - `category {categories, primary_only?}`, exact codes or `<group>.*`;
 *  - `keyword {terms, fields?, match?, mode?}` over title / abstract / author /
 *    source_id. `literal` is a case-insensitive substring (FTS5 trigram index
 *    for 3+ characters); `wildcard` matches whole words, with an optional `*`
 *    at either end of a 3–64 character alphanumeric stem.
 *
 * Rules are ANDed. A scope (`from` / `to` / `categories`) is shorthand for the
 * same time and category predicates on a set with no parent.
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { expandCategories, isKnownCategory } from '../taxonomy.ts'

export interface Scope {
  from?: string
  to?: string
  categories?: string[]
}

export type KeywordField = 'title' | 'abstract' | 'author' | 'source_id'

export type Rule =
  | { type: 'time_window', from?: string, to?: string }
  | { type: 'category', categories: string[], primary_only?: boolean }
  | { type: 'keyword', terms: string[], fields: KeywordField[], match: 'any' | 'all', mode: 'literal' | 'wildcard' }

export interface CompiledWhere {
  /** Predicates over `papers p`, to be ANDed. */
  clauses: string[]
  params: SQLInputValue[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const FIELDS: readonly KeywordField[] = ['title', 'abstract', 'author', 'source_id']
const WILDCARD_STEM_RE = /^[\p{L}\p{N}]{3,64}$/u
const MAX_TERMS = 32

function fail(message: string): never {
  throw new Error(message)
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${name} has unknown field "${key}" (allowed: ${allowed.join(', ')})`)
  }
}

function asDate(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail(`${name} must be a YYYY-MM-DD date`)
  }
  return value
}

function asCategories(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(`${name} must be an array of strings`)
  const cleaned = [...new Set((value as string[]).map(item => item.trim()).filter(item => item !== ''))]
  if (cleaned.length === 0) fail(`${name} must not be empty`)
  for (const token of cleaned) {
    if (!isKnownCategory(token)) fail(`${name}: "${token}" is not an arXiv category code or <group>.* wildcard`)
  }
  return cleaned
}

/** Validate a scope object (all fields optional; an empty scope is the whole corpus). */
export function parseScope(value: unknown): Scope | undefined {
  if (value === undefined || value === null) return undefined
  const raw = asObject(value, 'scope')
  onlyKeys(raw, ['from', 'to', 'categories'], 'scope')
  const scope: Scope = {}
  const from = asDate(raw.from, 'scope.from')
  const to = asDate(raw.to, 'scope.to')
  if (from !== undefined) scope.from = from
  if (to !== undefined) scope.to = to
  if (from !== undefined && to !== undefined && from > to) fail('scope.from must not be after scope.to')
  if (raw.categories !== undefined) scope.categories = asCategories(raw.categories, 'scope.categories')
  return Object.keys(scope).length === 0 ? undefined : scope
}

function parseRule(value: unknown, index: number): Rule {
  const name = `rules[${index}]`
  const raw = asObject(value, name)
  if (raw.type === 'time_window') {
    onlyKeys(raw, ['type', 'from', 'to'], name)
    const from = asDate(raw.from, `${name}.from`)
    const to = asDate(raw.to, `${name}.to`)
    if (from === undefined && to === undefined) fail(`${name}: time_window needs from or to`)
    if (from !== undefined && to !== undefined && from > to) fail(`${name}: from must not be after to`)
    return { type: 'time_window', ...from === undefined ? {} : { from }, ...to === undefined ? {} : { to } }
  }
  if (raw.type === 'category') {
    onlyKeys(raw, ['type', 'categories', 'primary_only'], name)
    if (raw.primary_only !== undefined && typeof raw.primary_only !== 'boolean') fail(`${name}.primary_only must be a boolean`)
    return { type: 'category', categories: asCategories(raw.categories, `${name}.categories`), ...raw.primary_only === true ? { primary_only: true } : {} }
  }
  if (raw.type === 'keyword') {
    onlyKeys(raw, ['type', 'terms', 'fields', 'match', 'mode'], name)
    if (!Array.isArray(raw.terms) || raw.terms.some(term => typeof term !== 'string')) fail(`${name}.terms must be an array of strings`)
    const terms = [...new Set((raw.terms as string[]).map(term => term.trim()).filter(term => term !== ''))]
    if (terms.length === 0) fail(`${name}.terms must not be empty`)
    if (terms.length > MAX_TERMS) fail(`${name}.terms allows at most ${MAX_TERMS} terms`)
    let fields: KeywordField[] = ['title', 'abstract']
    if (raw.fields !== undefined) {
      if (!Array.isArray(raw.fields) || raw.fields.length === 0 || raw.fields.some(field => !FIELDS.includes(field as KeywordField))) {
        fail(`${name}.fields must be a non-empty subset of ${FIELDS.join(', ')}`)
      }
      fields = [...new Set(raw.fields as KeywordField[])]
    }
    const match = raw.match === undefined ? 'any' : raw.match
    if (match !== 'any' && match !== 'all') fail(`${name}.match must be "any" or "all"`)
    const mode = raw.mode === undefined ? 'literal' : raw.mode
    if (mode !== 'literal' && mode !== 'wildcard') fail(`${name}.mode must be "literal" or "wildcard"`)
    if (mode === 'wildcard') {
      for (const term of terms) {
        const stem = term.replace(/^\*/, '').replace(/\*$/, '')
        if (!WILDCARD_STEM_RE.test(stem)) {
          fail(`${name}: wildcard term "${term}" needs a 3–64 character letters/digits stem, with * only at either end; put separate words in separate terms`)
        }
      }
    }
    return { type: 'keyword', terms, fields, match, mode }
  }
  fail(`${name}.type must be time_window, category or keyword`)
}

export function parseRules(value: unknown): Rule[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) fail('rules must be an array')
  if (value.length > 16) fail('at most 16 rules')
  return value.map((rule, index) => parseRule(rule, index))
}

/** Scope predicates expressed as rules, so one compiler serves both. */
export function scopeRules(scope: Scope | undefined): Rule[] {
  if (scope === undefined) return []
  const rules: Rule[] = []
  if (scope.from !== undefined || scope.to !== undefined) {
    rules.push({ type: 'time_window', ...scope.from === undefined ? {} : { from: scope.from }, ...scope.to === undefined ? {} : { to: scope.to } })
  }
  if (scope.categories !== undefined) rules.push({ type: 'category', categories: scope.categories })
  return rules
}

// -- SQL ------------------------------------------------------------------

const FTS_COLUMN: Partial<Record<KeywordField, string>> = { title: 'title', abstract: 'abstract', author: 'authors' }
const PAPER_COLUMN: Record<KeywordField, string> = { title: 'p.title', abstract: 'p.abstract', author: 'p.authors', source_id: 'p.source_id' }

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function ftsQuery(columns: string[], phrase: string): string {
  return `{${columns.join(' ')}} : "${phrase.replace(/"/g, '""')}"`
}

function wordPattern(term: string): string {
  const leading = term.startsWith('*')
  const trailing = term.endsWith('*')
  const stem = term.replace(/^\*/, '').replace(/\*$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `(?:^|[^\\p{L}\\p{N}])${leading ? '[\\p{L}\\p{N}]*' : ''}${stem}${trailing ? '[\\p{L}\\p{N}]*' : ''}(?:$|[^\\p{L}\\p{N}])`
}

const patternCache = new Map<string, RegExp>()

/**
 * Register the `pl_word(text, pattern)` SQL function used by wildcard rules.
 * Call once per connection before compiling rules against it.
 */
export function registerRuleFunctions(db: DatabaseSync): void {
  db.function('pl_word', { deterministic: true }, (text: unknown, pattern: unknown) => {
    if (typeof text !== 'string' || typeof pattern !== 'string') return 0
    let regex = patternCache.get(pattern)
    if (regex === undefined) {
      regex = new RegExp(pattern, 'iu')
      if (patternCache.size > 512) patternCache.clear()
      patternCache.set(pattern, regex)
    }
    return regex.test(text) ? 1 : 0
  })
}

function keywordTerm(term: string, rule: Extract<Rule, { type: 'keyword' }>, params: SQLInputValue[]): string {
  const ftsColumns = rule.fields.map(field => FTS_COLUMN[field]).filter((column): column is string => column !== undefined)
  const parts: string[] = []
  if (rule.mode === 'wildcard') {
    const stem = term.replace(/^\*/, '').replace(/\*$/, '')
    const pattern = wordPattern(term)
    // The trigram index narrows to rows containing the stem; the word test is exact.
    // Parameters are pushed in the order their placeholders appear.
    const prefilter = ftsColumns.length === rule.fields.length
    if (prefilter) params.push(ftsQuery(ftsColumns, stem))
    const words = rule.fields.map((field) => {
      params.push(pattern)
      return `pl_word(${PAPER_COLUMN[field]}, ?)`
    })
    return prefilter
      ? `(p.fts_rowid IN (SELECT rowid FROM papers_fts WHERE papers_fts MATCH ?) AND (${words.join(' OR ')}))`
      : `(${words.join(' OR ')})`
  }

  if (ftsColumns.length > 0 && [...term].length >= 3) {
    params.push(ftsQuery(ftsColumns, term))
    parts.push('p.fts_rowid IN (SELECT rowid FROM papers_fts WHERE papers_fts MATCH ?)')
  } else {
    for (const column of ftsColumns) {
      params.push(`%${escapeLike(term)}%`)
      parts.push(`p.${column} LIKE ? ESCAPE '\\'`)
    }
  }
  if (rule.fields.includes('source_id')) {
    params.push(`%${escapeLike(term)}%`)
    parts.push("p.source_id LIKE ? ESCAPE '\\'")
  }
  return `(${parts.join(' OR ')})`
}

/** Compile rules to predicates over `papers p`. */
export function compileRules(rules: readonly Rule[]): CompiledWhere {
  const clauses: string[] = []
  const params: SQLInputValue[] = []
  for (const rule of rules) {
    if (rule.type === 'time_window') {
      if (rule.from !== undefined) {
        clauses.push('substr(p.published_at, 1, 10) >= ?')
        params.push(rule.from)
      }
      if (rule.to !== undefined) {
        clauses.push('substr(p.published_at, 1, 10) <= ?')
        params.push(rule.to)
      }
    } else if (rule.type === 'category') {
      const codes = expandCategories(rule.categories)
      if (rule.primary_only === true) {
        clauses.push(`p.primary_category IN (${codes.map(() => '?').join(', ')})`)
        params.push(...codes)
      } else {
        clauses.push(`(${codes.map(() => "instr(' ' || p.categories || ' ', ?) > 0").join(' OR ')})`)
        params.push(...codes.map(code => ` ${code} `))
      }
    } else {
      const terms = rule.terms.map(term => keywordTerm(term, rule, params))
      clauses.push(`(${terms.join(rule.match === 'all' ? ' AND ' : ' OR ')})`)
    }
  }
  return { clauses, params }
}

// -- descriptions ---------------------------------------------------------

/** One-line English description of a rule, for tool output and the inspector. */
export function describeRule(rule: Rule): string {
  if (rule.type === 'time_window') return `submitted ${rule.from ?? '…'} .. ${rule.to ?? '…'}`
  if (rule.type === 'category') return `${rule.primary_only === true ? 'primary category' : 'category'} ${rule.categories.join(' | ')}`
  const joiner = rule.match === 'all' ? ' AND ' : ' OR '
  const quoted = rule.terms.map(term => `"${term}"`).join(joiner)
  return `keyword ${quoted} in ${rule.fields.join('/')}${rule.mode === 'wildcard' ? ' (whole words)' : ''}`
}

export function describeScope(scope: Scope | undefined): string {
  if (scope === undefined) return 'whole local corpus'
  return scopeRules(scope).map(describeRule).join('; ')
}
