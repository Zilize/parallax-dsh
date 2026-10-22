// Host-half smoke test: no Cordis here, just the pieces the plugin touches
// (ctx.effect, ctx.connection.fetch.register, ctx.tools, ctx.get('credentials')).
// Runs the built lib/index.js against a throwaway DSH_HOME seeded with a few
// papers, and exits non-zero on the first failed check. Jev is a local fake
// server; nothing leaves the machine.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'parallax-smoke-'))
// The fake Jev server is local: never route it through a proxy from the environment.
process.env.NO_PROXY = '127.0.0.1,localhost'
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

// Jev tuning: validated on save, and honoured by a real judging run.
check('tuning defaults', settings.body.jev.concurrency === 6 && settings.body.jev.batchSize === 30)
check('tuning rejects', (await call('/api/parallax/settings', post({ concurrency: 0 }))).status === 400
  && (await call('/api/parallax/settings', post({ batchSize: 61 }))).status === 400
  && (await call('/api/parallax/settings', post({ concurrency: 2.5 }))).status === 400)

const jev = { inFlight: 0, peak: 0, largest: 0, requests: 0 }
const server = createServer((request, response) => {
  let raw = ''
  request.on('data', (chunk) => { raw += chunk })
  request.on('end', () => {
    const { questions } = JSON.parse(raw)
    const keys = Object.keys(questions)
    jev.requests += 1
    jev.inFlight += 1
    jev.peak = Math.max(jev.peak, jev.inFlight)
    jev.largest = Math.max(jev.largest, keys.length)
    setTimeout(() => {
      jev.inFlight -= 1
      const answers = Object.fromEntries(keys.map((key, index) => [key, { type: 'noul', noul: index % 2 === 0 ? 0.9 : 0.1 }]))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: 'jev-test', usage: { input_tokens: 10, output_tokens: 1 }, answers }))
    }, 40)
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const tuned = await call('/api/parallax/settings', post({ baseUrl: `http://127.0.0.1:${server.address().port}`, concurrency: 3, batchSize: 4 }))
check('tuning saves', tuned.body.jev.concurrency === 3 && tuned.body.jev.batchSize === 4)

const extra = new DatabaseSync(join(process.env.DSH_HOME, 'storages', 'parallax.db'))
for (let index = 0; index < 30; index += 1) {
  const id = `2610.1${String(index).padStart(4, '0')}`
  const title = `Combinatorics note ${index}`
  extra.prepare(`INSERT INTO papers (source_id, title, abstract, authors, primary_category, categories, published_at, abs_url, pdf_url, fetched_at)
    VALUES (?, ?, ?, ?, 'math.CO', 'math.CO', '2026-10-05T10:00:00.000Z', '', '', '2026-10-05T10:00:00.000Z')`).run(id, title, 'A short note.', 'Paul Erdos')
}
extra.close()
const pool = codeOf(await tool('parallax_set', { action: 'create', name: 'notes', op: 'rule_filter', rules: [{ type: 'category', categories: ['math.CO'] }] }))
const judged = codeOf(await tool('parallax_set', { action: 'judge', name: 'kept notes', parent: pool, criteria: 'Keep every other paper.' }))
check('judging finishes', (await tool('parallax_set', { action: 'wait', set: judged, timeout_seconds: 30 })).startsWith('Judging finished.'))
const node = (await call('/api/parallax/flow?sessionId=smoke-session')).body.nodes.find(item => item.code === judged)
check('judging result', node.judged === 30 && node.count === 15 && node.undecided === 0, JSON.stringify({ judged: node.judged, count: node.count }))
check('tuning honoured', jev.largest === 4 && jev.peak === 3, JSON.stringify(jev))
server.close()

for (const dispose of disposers.reverse()) dispose?.()
console.log('smoke passed')
