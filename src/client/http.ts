/**
 * JSON over the host's Fetch routes, plus the small helpers every pane
 * shares: a subscribable value and number / error formatting.
 */

/** GET (or `init`) a JSON route; a non-2xx answer throws its `error` field. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body
}

/** POST a JSON body to a route. */
export async function post<T>(path: string, body: unknown): Promise<T> {
  return await request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A module-level value that React reads with `useSyncExternalStore`. */
export interface SharedValue<T> {
  get: () => T
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

export function sharedValue<T>(initial: T): SharedValue<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Paper and set counts always use grouped Western digits. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}
