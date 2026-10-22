/**
 * Validation for model-supplied tool arguments. Each helper names the
 * offending argument in its error, so the model can correct the call.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A trimmed string; absent, null or empty reads as undefined. */
export function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function requiredString(value: unknown, name: string): string {
  const text = optionalString(value, name)
  if (text === undefined) throw new Error(`${name} is required`)
  return text
}

/** A real calendar day as `YYYY-MM-DD`, or undefined when absent. */
export function optionalDate(value: unknown, name: string): string | undefined {
  const text = optionalString(value, name)
  if (text === undefined) return undefined
  if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error(`${name} must be a YYYY-MM-DD date`)
  return text
}

/** An integer clamped to `min..max`; absent reads as `fallback`. */
export function clampedInt(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`)
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

/** Distinct trimmed strings; absent or empty reads as undefined. */
export function optionalStringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${name} must be an array of strings`)
  const items = [...new Set((value as string[]).map(item => item.trim()).filter(item => item !== ''))]
  return items.length === 0 ? undefined : items
}

/** Narrow `value` to one of `actions`, or explain which ones exist. */
export function parseAction<A extends string>(value: unknown, actions: readonly A[]): A {
  const action = requiredString(value, 'action')
  if (!(actions as readonly string[]).includes(action)) throw new Error(`unknown action "${action}"; use ${actions.join(', ')}`)
  return action as A
}

/** `arXiv:2401.01234v2` → `2401.01234`. */
export function normalizeArxivId(raw: string): string {
  return raw.trim().replace(/^arxiv:/i, '').replace(/v\d+$/i, '')
}

/**
 * An abstract cut at a word boundary near `limit`, ending in a marker that
 * says where the full text is: the model must know the ending is missing.
 */
export function clipAbstract(text: string, limit: number, fullTextHint: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= limit) return clean
  const cut = clean.lastIndexOf(' ', limit)
  return `${clean.slice(0, cut > limit * 0.8 ? cut : limit)}… [trimmed; full abstract: ${fullTextHint}]`
}
