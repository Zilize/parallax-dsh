/**
 * Exact Fetch routes for the Ingest tab: the year calendar, job history, the
 * category scope, and starting or cancelling a harvest.
 */

import type { DatabaseSync } from 'node:sqlite'

import { failure, intParam, readBody, respond, type RouteRegistry } from '../host.ts'
import { normalizeCategories } from '../taxonomy.ts'
import { buildCalendar, countPapers, getCategories, listJobs, setCategories } from './db.ts'
import type { IngestService } from './runner.ts'

export function registerIngestRoutes(routes: RouteRegistry, db: DatabaseSync, ingest: IngestService): void {
  /** Everything the Ingest tab needs in one round trip. */
  routes.register({
    path: '/api/parallax/ingest/state',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const year = intParam(new URL(request.url), 'year', new Date().getUTCFullYear(), 2000, 2100)
      const categories = getCategories(db)
      return respond({
        year,
        categories,
        calendar: buildCalendar(db, year, categories),
        job: ingest.latest(),
        busy: ingest.busy,
        totalPapers: countPapers(db),
      })
    },
  })

  /** Recent harvest jobs, newest first. */
  routes.register({
    path: '/api/parallax/ingest/jobs',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => respond({ jobs: listJobs(db, intParam(new URL(request.url), 'limit', 20, 1, 100)) }),
  })

  /** Read or save the category scope. Changing it leaves earlier days partial. */
  routes.register({
    path: '/api/parallax/ingest/config',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return respond({ categories: getCategories(db) })
      try {
        const categories = normalizeCategories((await readBody(request)).categories, { allowEmpty: true })
        setCategories(db, categories)
        return respond({ ok: true, categories })
      } catch (error) {
        return failure(error)
      }
    },
  })

  /** Start a manual harvest over an inclusive UTC day range. */
  routes.register({
    path: '/api/parallax/ingest/run',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (ingest.busy) return failure('a harvest is already running', 409)
      try {
        const body = await readBody(request)
        const run = ingest.start({ from: body.from, to: body.to, categories: body.categories })
        return respond({ ok: true, from: run.from, to: run.to, days: run.days, categories: run.categories })
      } catch (error) {
        return failure(error)
      }
    },
  })

  /** Cancel the running harvest (its current day is left `failed`, not done). */
  routes.register({
    path: '/api/parallax/ingest/cancel',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const { id } = await readBody(request)
      return respond({ ok: ingest.cancel(id === undefined ? undefined : String(id)) })
    },
  })
}
