/**
 * Condition waiting for in-process services: callers block until a
 * predicate holds, re-checked whenever the owner calls `notify()`.
 */
export class Waiters {
  private readonly listeners = new Set<() => void>()

  /** Re-check every waiting condition. */
  notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /** Call `listener` on every notify until the returned function removes it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Resolve true once `ready()` holds, false on timeout or abort. */
  async until(ready: () => boolean, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (ready()) return true
    if (signal?.aborted === true) return false
    return await new Promise<boolean>((resolve) => {
      const settle = (value: boolean): void => {
        clearTimeout(timer)
        unsubscribe()
        signal?.removeEventListener('abort', aborted)
        resolve(value)
      }
      const aborted = (): void => { settle(false) }
      const timer = setTimeout(() => { settle(false) }, timeoutMs)
      const unsubscribe = this.subscribe(() => { if (ready()) settle(true) })
      signal?.addEventListener('abort', aborted, { once: true })
    })
  }
}
