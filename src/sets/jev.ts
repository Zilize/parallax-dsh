/**
 * Jev (TypeSafe System One) client and the set-judging protocol on top of it:
 *
 *  - `POST {base}/v1/systemone` with `{model, state, questions}`; answers are
 *    calibrated probabilities, not text, so judgements carry no reasons;
 *  - screening asks one Noul per paper and includes at p ≥ 0.5;
 *  - single-label classification asks one Choice per paper (plus `other`) and
 *    calls a paper uncertain below 0.8 confidence;
 *  - multi-label classification asks one Noul per paper × category, one paper
 *    per request, accepting labels at ≥ 0.8 and flagging 0.2–0.8 as borderline;
 *  - requests are packed under the API's question / byte / token limits and
 *    evidence is never truncated to fit; responses are validated strictly.
 */

import { fetch, type Dispatcher, type Response } from 'undici'

import type { Category, Decision, Thresholds } from './store.ts'

const MAX_QUESTIONS = 60
const MAX_INPUT_BYTES = 262_144
const MAX_INPUT_TOKENS = 48_000
const MAX_STATE_QUESTION_TOKENS = 24_000
const MAX_RETRIES = 2
const MAX_RETRY_WAIT_MS = 30_000
const REQUEST_TIMEOUT_MS = 180_000
const PROB_EPS = 1e-6

export interface JevRuntime {
  apiKey: string
  baseUrl: string
  /** Model new judging nodes freeze; running nodes keep their own. */
  model: string
  /** The Settings proxy (see ../ingest/network.ts); absent means direct. */
  dispatcher?: Dispatcher
}

/** Evidence sent for one paper. Identifiers are not evidence and are never sent. */
export interface PaperEvidence {
  title: string
  abstract: string
  author: string
  published_at: string
  categories: string
}

export interface Question {
  type: 'noul' | 'choice'
  instructions: unknown
  criteria?: Record<string, { name: string, criteria: string }>
}

export interface Payload {
  model: string
  state: Record<string, unknown>
  questions: Record<string, Question>
}

export type Answer =
  | { noul: number }
  | { choice: string, probabilities: Record<string, number>, confidence: number }

export interface SystemOneResult {
  model: string
  inputTokens: number
  outputTokens: number
  answers: Record<string, Answer>
}

class JevError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
  }
}

// -- limits ---------------------------------------------------------------

/** Conservative token estimate: CJK characters count as one token, others as a third. */
function estimateTokens(value: unknown): number {
  const text = JSON.stringify(value)
  let cjk = 0
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0
    if ((point >= 0x3000 && point <= 0x9fff) || (point >= 0xac00 && point <= 0xd7af) || (point >= 0xf900 && point <= 0xfaff)) cjk += 1
  }
  return Math.ceil(cjk + (text.length - cjk) / 3)
}

function requestFits(payload: Payload): boolean {
  const questions = Object.values(payload.questions)
  if (questions.length === 0 || questions.length > MAX_QUESTIONS) return false
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_INPUT_BYTES) return false
  if (estimateTokens(payload) > MAX_INPUT_TOKENS) return false
  const heaviest = Math.max(...questions.map(question => estimateTokens(question)))
  return estimateTokens({ state: payload.state }) + heaviest <= MAX_STATE_QUESTION_TOKENS
}

// -- payloads -------------------------------------------------------------

export function filterPayload(model: string, criteria: string, papers: readonly PaperEvidence[]): Payload {
  const questions: Record<string, Question> = {}
  papers.forEach((paper, index) => {
    questions[`p${index}`] = {
      type: 'noul',
      instructions: { paper, question: 'Should this paper be included according to the inclusion criteria?' },
    }
  })
  return {
    model,
    // The criteria stay the user's own wording, never rewritten.
    state: {
      task: 'per-paper inclusion screening for a research reading list',
      inclusion_criteria: criteria,
      note: 'For each question, judge only the paper embedded in that question against the criteria above.',
    },
    questions,
  }
}

function classifierEvidence(paper: PaperEvidence): { title: string, abstract: string } {
  return { title: paper.title, abstract: paper.abstract }
}

export function classifyPayload(
  model: string,
  categories: readonly Category[],
  mode: 'single_label' | 'multi_label',
  papers: readonly PaperEvidence[],
): Payload {
  if (mode === 'multi_label') {
    // Shared state, one paper per request: grouping unrelated papers made
    // decisions depend on their neighbours.
    const questions: Record<string, Question> = {}
    papers.forEach((_, paperIndex) => {
      categories.forEach((_, categoryIndex) => {
        questions[`p${paperIndex}_c${categoryIndex}`] = {
          type: 'noul',
          instructions: `Does the paper in \`papers[${paperIndex}]\` belong to the category defined in \`categories[${categoryIndex}]\`, according to that category's criteria?`,
        }
      })
    })
    return {
      model,
      state: {
        papers: papers.map(classifierEvidence),
        categories,
        note: "Evaluate each paper/category pair independently using only the referenced paper's title and abstract. Multiple categories may apply.",
      },
      questions,
    }
  }
  const choices: Record<string, { name: string, criteria: string }> = {}
  for (const category of categories) choices[category.key] = { name: category.name, criteria: category.criteria }
  choices.other = { name: 'other', criteria: 'Belongs to none of the categories above.' }
  const questions: Record<string, Question> = {}
  papers.forEach((paper, index) => {
    questions[`p${index}`] = {
      type: 'choice',
      instructions: {
        paper: { index, ...classifierEvidence(paper) },
        question: "Which category does this paper's main contribution belong to?",
      },
      criteria: choices,
    }
  })
  return {
    model,
    state: {
      task: 'per-paper classification against ALL category criteria',
      assignment_mode: mode,
      categories,
      note: 'For each question, judge only the paper embedded in that question against the categories above.',
    },
    questions,
  }
}

/**
 * Split papers into the largest request prefixes that fit, in order. A paper
 * that does not fit alone is an error: evidence is never shortened.
 */
export function packChunks<T>(
  items: readonly T[],
  build: (chunk: readonly T[]) => Payload,
  maxPerChunk = MAX_QUESTIONS,
): T[][] {
  const chunks: T[][] = []
  let start = 0
  while (start < items.length) {
    let low = 1
    let high = Math.min(maxPerChunk, items.length - start)
    let best = 0
    while (low <= high) {
      const middle = (low + high) >> 1
      if (requestFits(build(items.slice(start, start + middle)))) {
        best = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    if (best === 0) throw new JevError('a single paper exceeds the Jev input limits')
    chunks.push(items.slice(start, start + best))
    start += best
  }
  return chunks
}

// -- transport ------------------------------------------------------------

function validProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function protocol(message: string): never {
  throw new JevError(`Jev protocol error: ${message}`)
}

function validateAnswers(questions: Record<string, Question>, data: Record<string, unknown>): Record<string, Answer> {
  const answers = data.answers
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) protocol('response has no answers object')
  const given = answers as Record<string, unknown>
  const expected = Object.keys(questions)
  if (Object.keys(given).length !== expected.length || expected.some(key => !(key in given))) protocol('answers key set mismatch')
  const out: Record<string, Answer> = {}
  for (const [id, question] of Object.entries(questions)) {
    const answer = given[id] as Record<string, unknown> | null
    if (answer === null || typeof answer !== 'object') protocol(`answer ${id} is not an object`)
    if (answer.type !== question.type) protocol(`answer ${id} has type ${String(answer.type)}, expected ${question.type}`)
    if (question.type === 'noul') {
      if (!validProbability(answer.noul)) protocol(`answer ${id} has an invalid probability`)
      out[id] = { noul: answer.noul }
      continue
    }
    const options = Object.keys(question.criteria ?? {})
    const choice = answer.choice
    const probabilities = answer.probabilities as Record<string, unknown> | null
    if (typeof choice !== 'string' || !options.includes(choice)) protocol(`answer ${id} chose an unknown option`)
    if (probabilities === null || typeof probabilities !== 'object'
      || Object.keys(probabilities).length !== options.length || options.some(option => !validProbability(probabilities[option]))) {
      protocol(`answer ${id} has an invalid probability distribution`)
    }
    const values = options.map(option => probabilities[option] as number)
    const total = values.reduce((sum, value) => sum + value, 0)
    // jev-1.13.0 can return cent-rounded distributions summing to .99.
    const centRounded = values.every(value => Math.abs(value - Math.round(value * 100) / 100) <= PROB_EPS)
    if (Math.abs(total - 1) > PROB_EPS && (!centRounded || Math.abs(total - 1) > Math.min(0.02, options.length * 0.005) + PROB_EPS)) {
      protocol(`answer ${id} probabilities sum to ${total}`)
    }
    if (Math.abs((probabilities[choice] as number) - Math.max(...values)) > PROB_EPS) protocol(`answer ${id} disagrees with its argmax`)
    if (!validProbability(answer.confidence)) protocol(`answer ${id} has an invalid confidence`)
    const normalized: Record<string, number> = {}
    for (const option of options) normalized[option] = (probabilities[option] as number) / total
    out[id] = { choice, probabilities: normalized, confidence: answer.confidence }
  }
  return out
}

function retryWaitMs(response: Response | undefined, attempt: number): number {
  const ms = Number(response?.headers.get('retry-after-ms'))
  if (Number.isFinite(ms) && ms > 0) return Math.min(MAX_RETRY_WAIT_MS, ms)
  const seconds = Number(response?.headers.get('retry-after'))
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(MAX_RETRY_WAIT_MS, seconds * 1000)
  return Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** attempt + Math.random() * 250)
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

/** One System One call: transport errors, 429 and 5xx retry twice; other 4xx fail at once. */
export async function systemOne(runtime: JevRuntime, payload: Payload, signal?: AbortSignal): Promise<SystemOneResult> {
  if (!requestFits(payload)) throw new JevError('request exceeds the Jev input limits')
  const url = `${runtime.baseUrl.replace(/\/+$/, '')}/v1/systemone`
  // The payload carries the model frozen on the node at creation, not the current setting.
  const body = JSON.stringify(payload)
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    let response: Response | undefined
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${runtime.apiKey}`, 'content-type': 'application/json' },
        body,
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        ...runtime.dispatcher === undefined ? {} : { dispatcher: runtime.dispatcher },
      })
    } catch (error) {
      if (signal?.aborted === true) throw error
      lastError = new JevError(`Jev request failed: ${error instanceof Error ? error.message : String(error)}`, true)
      if (attempt < MAX_RETRIES) await sleep(retryWaitMs(undefined, attempt), signal)
      continue
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = new JevError(`Jev HTTP ${response.status}`, true)
      if (attempt < MAX_RETRIES) await sleep(retryWaitMs(response, attempt), signal)
      continue
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      if (response.status === 401 || response.status === 403) {
        throw new JevError(`Jev rejected the API key (HTTP ${response.status}); update it in Parallax settings`)
      }
      if (response.status === 451) {
        throw new JevError('Jev is not available from this network region (HTTP 451); set a proxy in Parallax settings')
      }
      throw new JevError(`Jev HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`)
    }
    const data = await response.json().catch(() => protocol('response is not JSON')) as Record<string, unknown>
    const usage = data.usage as Record<string, unknown> | undefined
    const inputTokens = usage?.input_tokens
    const outputTokens = usage?.output_tokens
    if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) protocol('response has no usage')
    return {
      model: typeof data.model === 'string' ? data.model : payload.model,
      inputTokens: inputTokens as number,
      outputTokens: outputTokens as number,
      answers: validateAnswers(payload.questions, data),
    }
  }
  throw lastError instanceof Error ? lastError : new JevError(String(lastError), true)
}

// -- mapping --------------------------------------------------------------

export function filterDecisions(ids: readonly string[], result: SystemOneResult, thresholds: Thresholds): Decision[] {
  return ids.map((sourceId, index) => {
    const p = (result.answers[`p${index}`] as { noul: number }).noul
    return {
      sourceId,
      outcome: p >= thresholds.noul ? 'include' : 'exclude',
      score: Math.round(p * 10_000) / 10_000,
      detail: { noul_threshold: thresholds.noul },
      model: result.model,
    }
  })
}

export function classifyDecisions(
  ids: readonly string[],
  result: SystemOneResult,
  categories: readonly Category[],
  mode: 'single_label' | 'multi_label',
  thresholds: Thresholds,
): Decision[] {
  return ids.map((sourceId, index) => {
    if (mode === 'single_label') {
      const answer = result.answers[`p${index}`] as { choice: string, probabilities: Record<string, number>, confidence: number }
      const outcome = answer.confidence < thresholds.choiceFloor ? 'uncertain' : answer.choice === 'other' ? 'other' : 'classified'
      return {
        sourceId,
        outcome,
        labels: outcome === 'classified' ? [answer.choice] : [],
        score: Math.round(answer.confidence * 10_000) / 10_000,
        detail: { choice: answer.choice, probabilities: answer.probabilities, choice_floor: thresholds.choiceFloor },
        model: result.model,
      }
    }
    const probabilities: Record<string, number> = {}
    categories.forEach((category, categoryIndex) => {
      probabilities[category.key] = (result.answers[`p${index}_c${categoryIndex}`] as { noul: number }).noul
    })
    const labels = categories.map(category => category.key).filter(key => probabilities[key] >= thresholds.label)
    const borderline = categories.map(category => category.key)
      .filter(key => probabilities[key] >= thresholds.labelFloor && probabilities[key] < thresholds.label)
    return {
      sourceId,
      outcome: labels.length > 0 ? 'classified' : borderline.length > 0 ? 'uncertain' : 'other',
      labels,
      score: null,
      detail: { probabilities, uncertain_labels: borderline, label_threshold: thresholds.label, label_floor: thresholds.labelFloor },
      model: result.model,
    }
  })
}
