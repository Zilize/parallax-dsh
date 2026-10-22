/**
 * Exact Fetch routes for the browser half: the conversation's flow graph, the
 * flow history, member pages, export downloads, job control and Jev settings.
 * Everything is addressed by query parameters — the Connection only matches
 * exact paths.
 */

import type { DatabaseSync } from 'node:sqlite'

import { failure, intParam, readBody, respond, type RouteRegistry } from '../host.ts'
import { describeNetwork, updateNetwork, type JevSettings } from '../settings.ts'
import type { FlowEvents } from './events.ts'
import { exportFileName, exportSet } from './export.ts'
import { judgingNode, type JudgeService } from './jobs.ts'
import { flowForSession, flowGraph, getFlow, listFlows, listMembers, setByCode, statusesOf, type MemberStatus } from './store.ts'

/** Longest a `/api/parallax/events` request is held open before returning empty. */
const EVENTS_WAIT_MS = 25_000

export function registerSetRoutes(routes: RouteRegistry, db: DatabaseSync, judges: JudgeService, settings: JevSettings, events?: FlowEvents): void {
  /**
   * Long-poll of flow events. `after` omitted returns the current head only
   * (the client's baseline, so a reload never replays old events).
   */
  routes.register({
    path: '/api/parallax/events',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (events === undefined) return respond({ head: 0, events: [] })
      const raw = new URL(request.url).searchParams.get('after')
      const after = raw === null ? Number.NaN : Number(raw)
      if (!Number.isInteger(after) || after < 0 || after > events.head) return respond({ head: events.head, events: [] })
      const list = await events.since(after, EVENTS_WAIT_MS, request.signal)
      return respond({ head: events.head, events: list })
    },
  })

  /** The graph of one flow: `flowId`, or the flow of `sessionId` (null before its first set). */
  routes.register({
    path: '/api/parallax/flow',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      const flowId = url.searchParams.get('flowId')
      const sessionId = url.searchParams.get('sessionId')
      const flow = flowId !== null ? getFlow(db, flowId) : sessionId !== null ? flowForSession(db, sessionId) : undefined
      const jev = await settings.describe()
      if (flow === undefined) return respond({ flow: null, nodes: [], jevConfigured: jev.configured })
      return respond({ ...flowGraph(db, flow), jevConfigured: jev.configured })
    },
  })

  routes.register({
    path: '/api/parallax/flows',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => respond({ flows: listFlows(db, intParam(new URL(request.url), 'limit', 50, 1, 200)) }),
  })

  routes.register({
    path: '/api/parallax/members',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      const set = setByCode(db, url.searchParams.get('set') ?? '')
      if (set === undefined) return failure('unknown set', 404)
      try {
        const page = listMembers(db, set, {
          status: (url.searchParams.get('status') ?? 'member') as MemberStatus,
          offset: Number(url.searchParams.get('offset') ?? 0),
          limit: Number(url.searchParams.get('limit') ?? 30),
        })
        return respond({ ...page, statuses: statusesOf(set.op) })
      } catch (error) {
        return failure(error)
      }
    },
  })

  routes.register({
    path: '/api/parallax/export',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const set = setByCode(db, new URL(request.url).searchParams.get('set') ?? '')
      if (set === undefined) return failure('unknown set', 404)
      try {
        const name = exportFileName(set)
        // `filename*` carries the real (often non-ASCII) name; `filename` is the ASCII fallback.
        return new Response(`${JSON.stringify(exportSet(db, set), null, 2)}\n`, {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="set-${set.code}.json"; filename*=UTF-8''${encodeURIComponent(name)}`,
          },
        })
      } catch (error) {
        return failure(error)
      }
    },
  })

  /** Stop or restart judging of a node (`action`: cancel | resume). */
  routes.register({
    path: '/api/parallax/judge',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const input = await readBody(request)
      const set = typeof input.set === 'string' ? setByCode(db, input.set) : undefined
      const judging = set === undefined ? undefined : judgingNode(db, set)
      if (judging === undefined) return failure('not a judging node', 404)
      try {
        if (input.action === 'cancel') return respond({ ok: judges.cancel(judging.id) })
        if (input.action === 'resume') {
          await judges.requireRuntime()
          return respond({ ok: true, job: judges.enqueue(judging) ?? null })
        }
        return failure('action must be cancel or resume')
      } catch (error) {
        return failure(error)
      }
    },
  })

  routes.register({
    path: '/api/parallax/settings',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return respond({ jev: await settings.describe(), network: describeNetwork(db) })
      const input = await readBody(request)
      const field = (name: string): string | null | undefined => {
        const value = input[name]
        return value === null ? null : typeof value === 'string' ? value : undefined
      }
      try {
        // An invalid proxy rejects the request before anything else is saved.
        const network = updateNetwork(db, { proxy: field('proxy') })
        return respond({ ok: true, jev: await settings.update({ apiKey: field('apiKey'), baseUrl: field('baseUrl'), model: field('model') }), network })
      } catch (error) {
        return failure(error)
      }
    },
  })
}
