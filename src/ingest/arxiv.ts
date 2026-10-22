/**
 * arXiv OAI-PMH client and record parser:
 *
 *  - endpoint `oaipmh.arxiv.org/oai`, `metadataPrefix=arXivRaw`;
 *  - one UTC **datestamp** day per ListRecords call, paged by `resumptionToken`.
 *    A datestamp is the record's last metadata change, not its submission
 *    date: a day's harvest holds new papers *and* revisions of old ones, and a
 *    paper revised later has already moved to a later datestamp;
 *  - ≥4s between requests with retry/backoff on 503/429 and transport errors;
 *  - `arXivRaw`'s `<version>` history is what makes `published_at` the *v1*
 *    date (the plain `arXiv` prefix reports the latest revision instead).
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { XMLParser } from 'fast-xml-parser'
import { fetch, type Dispatcher } from 'undici'

const OAI_ENDPOINT = 'https://oaipmh.arxiv.org/oai'
const METADATA_PREFIX = 'arXivRaw'
/** arXiv asks harvesters to wait at least this long between requests. */
export const DEFAULT_REQUEST_DELAY_MS = 4000
/** A set still paging after this many pages fails instead of truncating. */
const DEFAULT_MAX_PAGES = 400
const USER_AGENT = 'parallax-local/0.1 (dsh plugin)'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRIES = 5

export interface ArxivRecord {
  /** Version-less id, the storage key. */
  sourceId: string
  arxivVersion: number | null
  title: string
  abstract: string
  authors: string[]
  categories: string[]
  primaryCategory: string
  /** v1 submission date (UTC, ISO string), null when the history conflicts. */
  publishedAt: string | null
  updatedAt: string | null
  comments: string | null
  journalRef: string | null
  doi: string | null
  oaiIdentifier: string
  absUrl: string
  pdfUrl: string
}

/** One ListRecords page, already parsed. */
export interface HarvestPage {
  set: string
  page: number
  records: ArxivRecord[]
  /** Version-less ids of records the repository reports as deleted. */
  deleted: string[]
}

export interface HarvestOptions {
  /** OAI set specs to request for the day (`cs`, `cs:cs:LG`, …). */
  sets: string[]
  /** Delay between HTTP requests; defaults to `DEFAULT_REQUEST_DELAY_MS`. */
  requestDelayMs?: number
  /** A set still paging after this many pages fails instead of truncating. */
  maxPages?: number
  signal?: AbortSignal
  /** Routes requests through the configured proxy (see ./network.ts); direct when omitted. */
  dispatcher?: Dispatcher
  /** Called before each retry wait, so a slow network shows up as more than a frozen 0. */
  onRetry?: (retry: RetryInfo) => void
}

export interface RetryInfo {
  /** 1-based number of the retry about to happen. */
  attempt: number
  maxAttempts: number
  /** `timeout`, `HTTP 503`, or the transport error message. */
  reason: string
  waitMs: number
}

// `parseTagValue: false` keeps every value a string: the default number
// coercion turned `<id>2503.06640</id>` into 2503.0664. `htmlEntities` decodes
// the numeric references arXivRaw carries (`d&#39;Amore`, `&#34;`).
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  removeNSPrefix: true,
  parseTagValue: false,
  htmlEntities: true,
})

const VERSION_RE = /v(\d+)$/i

/** `2405.12345v2` → `2405.12345`. */
function stripVersion(id: string): string {
  return id.trim().replace(VERSION_RE, '')
}

function versionOf(id: string): number | null {
  const match = VERSION_RE.exec(id.trim())
  return match === null ? null : Number(match[1])
}

/** `oai:arXiv.org:2503.06640` → `2503.06640` (old-style ids keep their slash). */
function idFromOaiIdentifier(identifier: string): string {
  return identifier.trim().replace(/^oai:arXiv\.org:/i, '')
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return text(value[0])
  if (typeof value === 'object') return text((value as Record<string, unknown>)['#text'])
  return String(value).trim()
}

function collapse(value: unknown): string {
  return text(value).replace(/\s+/g, ' ').trim()
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function isoDate(raw: unknown): string | null {
  const value = text(raw)
  if (value === '') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

/** Drop `(...)` affiliations, including nested ones and their commas. */
function stripParenthesized(value: string): string {
  let out = ''
  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) out += char
  }
  return out
}

const NAME_SUFFIX_RE = /^(?:jr|sr|ii|iii|iv)\.?$/i

/**
 * arXivRaw keeps authors as one free-text string: `A, B, and C` or `A and B`,
 * often with `(Affiliation, City)` after a name.
 */
function parseAuthors(value: unknown): string[] {
  const raw = stripParenthesized(collapse(value)).replace(/\s+/g, ' ').trim()
  if (raw === '') return []
  const names: string[] = []
  for (const part of raw.split(/\s*,\s*|\s+and\s+/i)) {
    // `, and B` and the occasional `A and and B` leave a leading conjunction.
    const name = part.replace(/^(?:and(?:\s+|$))+/i, '').trim()
    if (name === '') continue
    // "John Smith, Jr." splits off the suffix; glue it back to its name.
    if (NAME_SUFFIX_RE.test(name) && names.length > 0) names[names.length - 1] += `, ${name}`
    else names.push(name)
  }
  return names
}

/** Version-less id of a `status="deleted"` record, or null for a live one. */
function deletedIdOf(record: Record<string, unknown>): string | null {
  const header = record.header as Record<string, unknown> | undefined
  if (header === undefined || text(header['@_status']) !== 'deleted') return null
  const identifier = text(header.identifier)
  return identifier === '' ? null : stripVersion(idFromOaiIdentifier(identifier))
}

/** Parse one live `<record>` element; deleted or malformed records return null. */
function parseRecord(record: Record<string, unknown>): ArxivRecord | null {
  const header = record.header as Record<string, unknown> | undefined
  if (header === undefined) return null
  const identifier = text(header.identifier)
  if (identifier === '') return null
  if (text(header['@_status']) === 'deleted') return null

  const metadata = record.metadata as Record<string, unknown> | undefined
  const raw = metadata?.arXivRaw as Record<string, unknown> | undefined
  if (raw === undefined) return null

  const id = text(raw.id) || idFromOaiIdentifier(identifier)
  const baseId = stripVersion(id)
  const categories = collapse(raw.categories).split(/\s+/).filter(Boolean)

  const versions = asArray(raw.version as Record<string, unknown> | Array<Record<string, unknown>> | undefined)
  const numbered = versions
    .map(entry => ({
      version: versionOf(text((entry as Record<string, unknown>)['@_version'])),
      date: isoDate((entry as Record<string, unknown>).date),
    }))
    .filter(entry => entry.version !== null)

  const v1Dates = new Set(
    numbered.filter(entry => entry.version === 1 && entry.date !== null).map(entry => entry.date as string),
  )
  const latest = numbered.reduce<{ version: number, date: string | null } | null>(
    (best, entry) => (best === null || (entry.version ?? 0) > best.version ? { version: entry.version ?? 0, date: entry.date } : best),
    null,
  )

  // Two different v1 dates mean the history is inconsistent: store no
  // publication date rather than guess one.
  const publishedAt = v1Dates.size === 1 ? [...v1Dates][0] : null
  const arxivVersion = latest?.version ?? null
  const versionedId = arxivVersion === null ? id : `${baseId}v${arxivVersion}`

  return {
    sourceId: baseId,
    arxivVersion,
    title: collapse(raw.title),
    abstract: collapse(raw.abstract),
    authors: parseAuthors(raw.authors),
    categories,
    primaryCategory: categories[0] ?? '',
    publishedAt,
    updatedAt: latest?.date ?? isoDate(header.datestamp),
    comments: collapse(raw.comments) || null,
    journalRef: collapse(raw['journal-ref']) || null,
    doi: collapse(raw.doi) || null,
    oaiIdentifier: identifier,
    absUrl: `https://arxiv.org/abs/${versionedId}`,
    pdfUrl: `https://arxiv.org/pdf/${versionedId}.pdf`,
  }
}

interface OaiPage {
  records: Array<Record<string, unknown>>
  token: string | null
}

/** Parse one ListRecords response; throws on an OAI error element. */
function parsePage(xml: string): OaiPage {
  const document = parser.parse(xml) as Record<string, unknown>
  const root = document['OAI-PMH'] as Record<string, unknown> | undefined
  if (root === undefined) throw new Error('OAI response is not an OAI-PMH document')

  const error = root.error as Record<string, unknown> | undefined
  if (error !== undefined) {
    const code = text(error['@_code']) || 'error'
    // NoRecordsMatch is a normal empty day, not a failure.
    if (code === 'noRecordsMatch') return { records: [], token: null }
    throw new Error(`OAI ${code}: ${collapse(error)}`)
  }

  const list = root.ListRecords as Record<string, unknown> | undefined
  if (list === undefined) return { records: [], token: null }
  const records = asArray(list.record as Record<string, unknown> | Array<Record<string, unknown>>)
  const tokenNode = list.resumptionToken as Record<string, unknown> | string | undefined
  const token = tokenNode === undefined ? null : (text(tokenNode) || null)
  return { records, token }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout'
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: unknown, message?: unknown } }).cause
    const detail = typeof cause?.code === 'string' ? cause.code : typeof cause?.message === 'string' ? cause.message : null
    return detail === null ? error.message : `${error.message} (${detail})`
  }
  return String(error)
}

/** One HTTP call with transport retries and 503/429 backoff; every attempt is time-boxed. */
async function requestOai(url: string, options: HarvestOptions): Promise<string> {
  const { signal, dispatcher, onRetry } = options
  let lastReason = ''
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/xml' },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        ...dispatcher === undefined ? {} : { dispatcher },
      })
      if (response.status === 503 || response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '20')
        const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 20_000
        lastReason = `HTTP ${response.status}`
        onRetry?.({ attempt: attempt + 1, maxAttempts: MAX_RETRIES, reason: lastReason, waitMs })
        await sleep(waitMs)
        continue
      }
      if (!response.ok) throw new Error(`OAI HTTP ${response.status} ${response.statusText}`)
      return await response.text()
    } catch (error) {
      if (signal?.aborted === true) throw error
      lastReason = describeError(error)
      if (attempt >= MAX_RETRIES) break
      const waitMs = 3000 * 2 ** attempt
      onRetry?.({ attempt: attempt + 1, maxAttempts: MAX_RETRIES, reason: lastReason, waitMs })
      await sleep(waitMs)
    }
  }
  throw new Error(lastReason === 'timeout'
    ? `OAI request timed out ${MAX_RETRIES + 1} times (${REQUEST_TIMEOUT_MS / 1000}s each)`
    : `OAI request failed after ${MAX_RETRIES + 1} attempts: ${lastReason}`)
}

/**
 * Harvest one UTC datestamp day across every requested OAI set, yielding one
 * parsed page at a time so the caller can commit each page on its own.
 * Filtering by category is the caller's job, and a paper cross-listed in two
 * requested sets arrives once per set.
 */
export async function* harvestDayPages(day: string, options: HarvestOptions): AsyncGenerator<HarvestPage> {
  for (const [index, set] of options.sets.entries()) {
    if (index > 0) await sleep(options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS)
    yield* harvestSet(day, set, options)
  }
}

async function* harvestSet(day: string, set: string, options: HarvestOptions): AsyncGenerator<HarvestPage> {
  const delay = options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  let url = `${OAI_ENDPOINT}?verb=ListRecords&from=${day}&until=${day}&metadataPrefix=${METADATA_PREFIX}&set=${encodeURIComponent(set)}`

  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1) await sleep(delay)
    options.signal?.throwIfAborted()
    const xml = await requestOai(url, options)
    const parsed = parsePage(xml)

    const records: ArxivRecord[] = []
    const deleted: string[] = []
    for (const raw of parsed.records) {
      const gone = deletedIdOf(raw)
      if (gone !== null) {
        deleted.push(gone)
        continue
      }
      const record = parseRecord(raw)
      if (record !== null) records.push(record)
    }
    yield { set, page, records, deleted }

    if (parsed.token === null) return
    url = `${OAI_ENDPOINT}?verb=ListRecords&resumptionToken=${encodeURIComponent(parsed.token)}`
  }
  // Truncating here and marking the day done would be a false green.
  throw new Error(`OAI set ${set} still paging after ${maxPages} pages for ${day}`)
}
