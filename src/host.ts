/**
 * The slices of the dsh host API this plugin relies on, plus small helpers
 * shared by every tool and route. The host is reached through structural
 * types rather than its packages, so the plugin builds without them.
 */

import type { DshToolExec } from './dsh-jobs.ts'

/** One model-facing tool, as `ctx.tools.register` takes it. */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => Array<{ type: 'text', text: string }>
  }
  isConcurrencySafe?: (args: unknown) => boolean
  execute: (args: Record<string, unknown>, exec: ToolExec) => Promise<string>
}

export type ToolExec = { signal: AbortSignal, agent?: AgentLike } & DshToolExec

export interface ToolRegistry {
  register(definition: ToolDefinition): () => void
}

/** Every tool returns plain text, rendered as is. */
export const TEXT_OUTPUT: ToolDefinition['output'] = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

/** One exact-path Fetch route on the connection (`ctx.connection.fetch`). */
export interface Route {
  path: string
  methods: string[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
}

export interface RouteRegistry {
  register(route: Route): unknown
}

/** The agent a tool call runs in, as far as session resolution needs it. */
export interface AgentLike {
  id?: string
  session?: { header?: { parentSession?: string, origin?: string, cwd?: string } }
  ctx?: { get?: (name: string) => unknown }
}

/** Subagent chains deeper than this are not followed. */
const MAX_SUBAGENT_DEPTH = 16

/**
 * The conversation that owns the calling agent's work: a subagent resolves
 * to its root session, so batch work lands on the same graph. `cwd` is the
 * calling session's own workspace.
 */
export function rootSession(agent: AgentLike | undefined): { sessionId: string, cwd?: string } {
  if (agent?.id === undefined) throw new Error('this tool needs a conversation session')
  let sessionId = agent.id
  let header = agent.session?.header
  const cwd = header?.cwd
  const agents = agent.ctx?.get?.('agents') as { get?: (id: string) => AgentLike | undefined } | undefined
  for (let depth = 0; depth < MAX_SUBAGENT_DEPTH && header?.origin === 'subagent' && header.parentSession !== undefined; depth += 1) {
    sessionId = header.parentSession
    header = agents?.get?.(sessionId)?.session?.header
  }
  return { sessionId, ...cwd === undefined ? {} : { cwd } }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const

export function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export function failure(error: unknown, status = 400): Response {
  return respond({ ok: false, error: errorMessage(error) }, status)
}

/** The request's JSON object body; anything else (empty, malformed, an array) reads as `{}`. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json() as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** A bounded integer query parameter, or `fallback` when absent or out of range. */
export function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = Number(url.searchParams.get(name) ?? fallback)
  return Number.isInteger(raw) && raw >= min && raw <= max ? raw : fallback
}
