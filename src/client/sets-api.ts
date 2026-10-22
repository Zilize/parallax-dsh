/**
 * Client side of the set-graph API. The shapes are the host's own types,
 * imported type-only, so both halves always agree on the wire format.
 */

import type { JevSettingsChange, JevSettingsView } from '../settings.ts'
import type { ProxyView } from '../ingest/network.ts'
import type { FlowEvent } from '../sets/events.ts'
import type { FlowRow, FlowSummary, MemberPage as HostMemberPage, MemberStatus, NodeView } from '../sets/store.ts'
import { post, request, sharedValue } from './http.ts'

export type { FlowEvent } from '../sets/events.ts'
export type { JevSettingsView } from '../settings.ts'
export type { ProxyView as NetworkView } from '../ingest/network.ts'
export type { EdgeRole, FlowSummary, JobView, MemberPaper, MemberStatus, NodeView, Op } from '../sets/store.ts'

export interface FlowGraph {
  /** Null before the conversation's first set. */
  flow: FlowRow | null
  nodes: NodeView[]
  jevConfigured: boolean
}

export interface MemberPage extends HostMemberPage {
  /** Every status this node can list. */
  statuses: MemberStatus[]
}

/** Judging is still moving for this node. */
export function isJudging(node: NodeView): boolean {
  return node.job?.status === 'pending' || node.job?.status === 'running'
}

export async function loadFlow(target: { sessionId?: string, flowId?: string }): Promise<FlowGraph> {
  const query = target.flowId !== undefined ? `flowId=${encodeURIComponent(target.flowId)}` : `sessionId=${encodeURIComponent(target.sessionId ?? '')}`
  return await request<FlowGraph>(`/api/parallax/flow?${query}`)
}

/** Long-poll the host's flow events; `after` omitted returns only the current head. */
export async function pollFlowEvents(after: number | undefined, signal: AbortSignal): Promise<{ head: number, events: FlowEvent[] }> {
  const query = after === undefined ? '' : `?after=${after}`
  return await request(`/api/parallax/events${query}`, { signal })
}

export async function loadFlows(): Promise<FlowSummary[]> {
  return (await request<{ flows: FlowSummary[] }>('/api/parallax/flows')).flows
}

export async function loadMembers(code: string, status: MemberStatus, offset: number, limit: number): Promise<MemberPage> {
  return await request<MemberPage>(`/api/parallax/members?set=${encodeURIComponent(code)}&status=${status}&offset=${offset}&limit=${limit}`)
}

export async function controlJudging(code: string, action: 'cancel' | 'resume'): Promise<void> {
  await post('/api/parallax/judge', { set: code, action })
}

interface SettingsResponse {
  jev: JevSettingsView
  network: ProxyView
}

export async function loadSettings(): Promise<SettingsResponse> {
  return await request<SettingsResponse>('/api/parallax/settings')
}

export async function saveJevSettings(change: JevSettingsChange): Promise<JevSettingsView> {
  return (await post<SettingsResponse>('/api/parallax/settings', change)).jev
}

/** `proxy: null` clears the setting and falls back to the environment. */
export async function saveProxy(proxy: string | null): Promise<ProxyView> {
  return (await post<SettingsResponse>('/api/parallax/settings', { proxy })).network
}

/**
 * Download a set's JSON export. Fetched and handed over as a blob so it works
 * on both carriers (browser HTTP and the desktop shell), where a plain link
 * navigation would not carry the route.
 */
export async function downloadExport(code: string): Promise<void> {
  const response = await fetch(`/api/parallax/export?set=${encodeURIComponent(code)}`)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${response.status}`)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const name = encoded === undefined ? `set-${code}.json` : decodeURIComponent(encoded)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * The flow the canvas shows. The canvas only opens pointed at a flow (from a
 * History card or the model's first node), so it never shows a session
 * without sets.
 */
export const viewedFlow = sharedValue<string | null>(null)
