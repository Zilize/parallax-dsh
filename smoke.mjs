// Host-half smoke test: no Cordis here, just the pieces the plugin touches
// (ctx.effect, ctx.connection.fetch.register, ctx.tools, ctx.get('credentials')).
// Runs the built lib/index.js against a throwaway DSH_HOME seeded with three
// papers, and exits non-zero on the first failed check. No network is used.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'parallax-smoke-'))
const { apply } = await import('./lib/index.js')

const routes = new Map()
const tools = new Map()
const secrets = new Map()
const disposers = []
const ctx = {
  effect(fn) {
    const dispose = fn()
    disposers.push(dispose)
    return () => dispose?.()
  },
  connection: { fetch: { register(route) { routes.set(route.path, route); return async () => {} } } },
  tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
  get(name) {
    if (name !== 'credentials') return undefined
    return {
      async resolve(ref) { return secrets.has(ref) ? { value: secrets.get(ref), source: 'file' } : undefined },
      async describe(ref) { return { configured: secrets.has(ref), writable: true, ...secrets.has(ref) ? { source: 'file' } : {} } },
      async set(ref, value) { secrets.set(ref, value) },
      async unset(ref) { secrets.delete(ref) },
    }
  },
}

apply(ctx)

// Seed the corpus the way a harvest would leave it: papers plus their FTS rows.
const db = new DatabaseSync(join(process.env.DSH_HOME, 'storages', 'parallax.db'))
const papers = [
  ['2610.00001', 'Agentic planning with language models', 'We study LLM agents that plan tool use.', 'Ada Lovelace, Alan Turing', 'cs.AI', 'cs.AI cs.CL', '2026-10-02T10:00:00.000Z'],
  ['2610.00002', 'Diffusion models for images', 'A diffusion approach to image synthesis.', 'Grace Hopper', 'cs.CV', 'cs.CV', '2026-10-03T10:00:00.000Z'],
  ['2610.00003', 'Multi-agent debate', 'Agents debate to improve answers of language models.', 'Edsger Dijkstra', 'cs.CL', 'cs.CL cs.AI', '2026-10-04T10:00:00.000Z'],
]
for (const [id, title, abstract, authors, primary, categories, published] of papers) {
  db.prepare(`INSERT INTO papers (source_id, title, abstract, authors, primary_category, categories, published_at, abs_url, pdf_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, title, abstract, authors, primary, categories, published, `https://arxiv.org/abs/${id}v1`, `https://arxiv.org/pdf/${id}v1.pdf`, published)
  const row = db.prepare('INSERT INTO papers_fts (source_id, title, abstract, authors) VALUES (?, ?, ?, ?)').run(id, title, abstract, authors)
  db.prepare('UPDATE papers SET fts_rowid = ? WHERE source_id = ?').run(Number(row.lastInsertRowid), id)
}
db.close()

const call = async (path, init) => {
  const route = routes.get(path.split('?')[0])
  if (route === undefined) throw new Error(`no route ${path}`)
  const response = await route.fetch(new Request(`http://host${path}`, init))
  return { status: response.status, body: await response.json() }
}
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const agent = { id: 'smoke-session', session: { header: { cwd: process.env.DSH_HOME } } }
const tool = async (name, args) => await tools.get(name).execute(args, { signal: new AbortController().signal, agent })
const codeOf = text => /\(([a-z0-9]{8})\)/.exec(text)[1]
const check = (label, condition, detail = '') => {
  assert.ok(condition, `${label} ${detail}`)
  console.log(`ok   ${label}`)
}

// Registration
check('routes', routes.size === 12, [...routes.keys()].join(' '))
check('tools', ['parallax', 'parallax_set', 'parallax_ingest'].every(name => tools.has(name)))

// Settings
const settings = await call('/api/parallax/settings')
check('settings default', settings.status === 200 && settings.body.jev.configured === false && settings.body.jev.model === 'jev-1.13.0')
const saved = await call('/api/parallax/settings', post({ apiKey: 'sk-smoke', model: 'jev-test' }))
check('settings save', saved.body.jev.configured === true && saved.body.jev.model === 'jev-test' && secrets.get('PARALLAX_JEV_API_KEY') === 'sk-smoke')
check('settings bad url', (await call('/api/parallax/settings', post({ baseUrl: 'ftp://x' }))).status === 400)

// Ingest routes and tool
check('ingest config empty', (await call('/api/parallax/ingest/config')).body.categories.length === 0)
check('ingest run needs scope', (await call('/api/parallax/ingest/run', post({ from: '2026-10-01', to: '2026-10-02' }))).status === 400)
check('ingest config rejects', (await call('/api/parallax/ingest/config', post({ categories: ['nope.XX'] }))).status === 400)
check('ingest config saves', (await call('/api/parallax/ingest/config', post({ categories: ['cs.AI', 'cs.CL'] }))).body.ok === true)
const state = await call('/api/parallax/ingest/state?year=2026')
check('ingest state', state.body.calendar.length === 365 && state.body.totalPapers === 3 && state.body.busy === false)
check('ingest jobs', Array.isArray((await call('/api/parallax/ingest/jobs')).body.jobs))
check('ingest cancel idle', (await call('/api/parallax/ingest/cancel', post({}))).body.ok === false)
check('ingest tool status', (await tool('parallax_ingest', { action: 'status' })).includes('Category scope: cs.AI, cs.CL.'))
check('ingest tool coverage', (await tool('parallax_ingest', { action: 'coverage', from: '2026-10-01', to: '2026-10-05' })).includes('missing 5'))
check('ingest tool bad action', await tool('parallax_ingest', { action: 'nope' }).then(() => false, error => /unknown action/.test(error.message)))

// Corpus tool
check('search', (await tool('parallax', { action: 'search', query: 'agent' })).includes('Returned 2 paper(s)'))
check('search category', (await tool('parallax', { action: 'search', categories: ['cs.CV'] })).includes('Returned 1 paper(s)'))
check('paper', (await tool('parallax', { action: 'paper', ids: ['arXiv:2610.00002v1', '2610.99999'] })).includes('Not in the local corpus: 2610.99999'))
check('doc', (await tool('parallax', { action: 'doc', path: 'SKILL.md' })).startsWith('---'))
check('doc escape', await tool('parallax', { action: 'doc', path: '../x.md' }).then(() => false, () => true))

// Set graph
check('inspect empty', (await tool('parallax_set', { action: 'inspect' })).includes('no sets yet'))
check('probe', (await tool('parallax_set', { action: 'probe', rules: [{ type: 'keyword', terms: ['agent'] }] })).includes('Matches: 2 papers.'))
const agents = codeOf(await tool('parallax_set', { action: 'create', name: 'agents', op: 'rule_filter', rules: [{ type: 'keyword', terms: ['agent'] }] }))
const seed = codeOf(await tool('parallax_set', { action: 'create', name: 'named', op: 'seed', ids: ['2610.00002', '2610.99999'] }))
const union = codeOf(await tool('parallax_set', { action: 'create', name: 'both', op: 'union', parents: [agents, seed] }))
const minus = codeOf(await tool('parallax_set', { action: 'create', name: 'minus', op: 'subtract', base: union, remove: seed }))
const graph = await call('/api/parallax/flow?sessionId=smoke-session')
const counts = Object.fromEntries(graph.body.nodes.map(node => [node.code, node.count]))
check('set counts', counts[agents] === 2 && counts[seed] === 1 && counts[union] === 3 && counts[minus] === 2, JSON.stringify(counts))
const members = await call(`/api/parallax/members?set=${union}&offset=0&limit=2`)
check('members page', members.body.total === 3 && members.body.papers.length === 2)
check('members tool', (await tool('parallax_set', { action: 'members', set: minus })).includes('2 paper(s)'))
check('flows', (await call('/api/parallax/flows')).body.flows[0].setCount === 4)

// Export: a plain array of paper metadata, on disk and over HTTP.
const exported = await tool('parallax_set', { action: 'export', set: union })
const file = exported.split('→ ')[1]
const list = JSON.parse(readFileSync(file, 'utf8'))
check('export file', Array.isArray(list) && list.length === 3 && Array.isArray(list[0].authors) && 'abs_url' in list[0])
const route = routes.get('/api/parallax/export')
const response = await route.fetch(new Request(`http://host/api/parallax/export?set=${union}`))
check('export route', response.status === 200 && (await response.json()).length === 3)

for (const dispose of disposers.reverse()) dispose?.()
console.log('smoke passed')
