/**
 * Open a tab when the model acts: the canvas when it starts a conversation's
 * graph (`flow-started`), the Ingest tab when it starts a harvest
 * (`harvest-started`).
 *
 * This watcher long-polls the host's event feed. A tab opens only for the
 * conversation on screen: an event for another conversation waits until the
 * user switches to it, the way the shell's plan review auto-opens; only that
 * conversation's latest event is kept. A reload takes the current head as its
 * baseline, so old events never reopen anything.
 */

import { pollFlowEvents, type FlowEvent } from './sets-api.ts'

const RETRY_MS = 5000

/** The slice of `ctx.sidebarRight.mounted` (a snapshot store) used here. */
export interface MountedSession {
  getSnapshot(): string | undefined
  subscribe?(listener: () => void): () => void
}

export function watchAutoOpen(mounted: MountedSession | undefined, open: (event: FlowEvent) => void): () => void {
  const controller = new AbortController()
  /** sessionId → the event whose tab still has to open. */
  const pending = new Map<string, FlowEvent>()
  let fallback: ReturnType<typeof setInterval> | undefined

  const flush = (): void => {
    const sessionId = mounted?.getSnapshot()
    const event = sessionId === undefined ? undefined : pending.get(sessionId)
    if (event !== undefined) {
      pending.delete(event.sessionId)
      open(event)
    }
    // Without a subscription, re-check while something is waiting.
    if (mounted?.subscribe === undefined && pending.size > 0 && fallback === undefined) {
      fallback = setInterval(() => {
        flush()
        if (pending.size === 0 && fallback !== undefined) { clearInterval(fallback); fallback = undefined }
      }, 1000)
    }
  }
  const unsubscribe = mounted?.subscribe?.(flush)

  const run = async (): Promise<void> => {
    let head: number | undefined
    while (!controller.signal.aborted) {
      try {
        const page = await pollFlowEvents(head, controller.signal)
        if (head !== undefined) {
          for (const event of page.events) pending.set(event.sessionId, event)
          if (page.events.length > 0) flush()
        }
        head = page.head
      } catch {
        if (controller.signal.aborted) return
        await new Promise(resolve => setTimeout(resolve, RETRY_MS))
      }
    }
  }
  void run()

  return () => {
    controller.abort()
    unsubscribe?.()
    if (fallback !== undefined) clearInterval(fallback)
  }
}
