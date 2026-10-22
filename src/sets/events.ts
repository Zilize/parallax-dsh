/**
 * Flow events for the browser half: a small in-memory feed the client
 * long-polls, so a tab can open itself the moment the model acts: the canvas
 * when it starts a conversation's graph, the Ingest tab when it starts a
 * harvest. Nothing is persisted; a reload only sees new events.
 */

import { Waiters } from '../wait.ts'

export type FlowEvent =
  /** The model created the first node of this flow. */
  | { seq: number, type: 'flow-started', sessionId: string, flowId: string }
  /** The model started a harvest run over from..to. */
  | { seq: number, type: 'harvest-started', sessionId: string, jobId: string, from: string, to: string }

type Unsequenced<T> = T extends unknown ? Omit<T, 'seq'> : never

/** Events kept for clients that fall behind. */
const KEEP = 100

export class FlowEvents {
  private seq = 0
  private events: FlowEvent[] = []
  private readonly waiters = new Waiters()

  /** Current sequence number: a client's baseline before it waits. */
  get head(): number {
    return this.seq
  }

  publish(event: Unsequenced<FlowEvent>): void {
    this.seq += 1
    this.events.push({ ...event, seq: this.seq } as FlowEvent)
    if (this.events.length > KEEP) this.events.splice(0, this.events.length - KEEP)
    this.waiters.notify()
  }

  /** Events after `after`, waiting up to `timeoutMs` when there are none yet. */
  async since(after: number, timeoutMs: number, signal?: AbortSignal): Promise<FlowEvent[]> {
    const pending = (): FlowEvent[] => this.events.filter(event => event.seq > after)
    await this.waiters.until(() => pending().length > 0, timeoutMs, signal)
    return pending()
  }
}
