/**
 * Parallax — host half.
 *
 * Runs inside the dsh host process (plain Node, no browser) and owns the
 * durable side of the plugin: one SQLite database under `$DSH_HOME/storages`,
 * exposed to the browser half through exact Fetch routes on the connection.
 *
 *  - arXiv metadata ingestion (`src/ingest`): manual day-range harvests over
 *    OAI-PMH, keyword-recallable papers, per-day coverage;
 *  - the set graph (`src/sets`): per-conversation flows of immutable sets the
 *    model builds with `parallax_set`, and the Jev judging jobs behind them;
 *  - the model-facing tools and the packaged research skill.
 *
 * The browser half talks to this one through `ctx.connection.fetch` routes,
 * which answer over both the HTTP carrier and the desktop shell.
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { Context } from '@deepseek-ai/cordis'

import type { DshJobRegistry } from './dsh-jobs.ts'
import type { RouteRegistry, ToolRegistry } from './host.ts'
import { failStaleCoverage, failStaleJobs, openIngestStore } from './ingest/db.ts'
import { registerIngestRoutes } from './ingest/routes.ts'
import { IngestService } from './ingest/runner.ts'
import { registerIngestTool } from './ingest/tool.ts'
import { FlowEvents } from './sets/events.ts'
import { JudgeService } from './sets/jobs.ts'
import { registerSetRoutes } from './sets/routes.ts'
import { registerRuleFunctions } from './sets/rules.ts'
import { openSetStore } from './sets/store.ts'
import { registerSetTool } from './sets/tool.ts'
import { JevSettings, type CredentialStore } from './settings.ts'
import { createParallaxSkillProvider, type SkillProviderControl } from './skills/provider.ts'
import { registerParallaxTool } from './tools.ts'

export const name = 'parallax'

/** `connection` must be up before the routes can be registered. */
export const inject = ['connection', 'skills', 'tools']

/** The host services this plugin reaches; `skills` and `tools` are absent in bare harnesses. */
type HostContext = Context & {
  connection: { fetch: RouteRegistry }
  skills?: { registerProvider: (create: (control: SkillProviderControl) => unknown) => () => void }
  tools?: ToolRegistry
  get?: (name: string) => unknown
}

/** Same precedence as the host's own home resolution: `$DSH_HOME`, else `~/.dsh`. */
function databaseFile(): string {
  const home = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'parallax.db')
}

export function apply(ctx: Context): void {
  const host = ctx as HostContext
  const file = databaseFile()
  mkdirSync(dirname(file), { recursive: true })

  // node:sqlite ships with Node >= 22.5: no native module to compile.
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  openIngestStore(db)
  openSetStore(db)
  registerRuleFunctions(db)
  // A previous process may have stopped mid-day; never leave rows "running".
  failStaleJobs(db)
  failStaleCoverage(db)
  // Nothing else closes this handle: Cordis disposes it when the plugin unloads.
  ctx.effect(() => () => db.close())

  // `credentials` and `jobs` are looked up per call, not injected: their
  // plugins may come and go, and without a credential store the Jev key can
  // still come from the environment.
  const settings = new JevSettings(db, () => host.get?.('credentials') as CredentialStore | undefined)
  const dshJobs = (): DshJobRegistry | undefined => host.get?.('jobs') as DshJobRegistry | undefined

  const judges = new JudgeService(db, settings)
  // Judging left pending by a stopped process resumes; unloading pauses it again.
  judges.recover()
  ctx.effect(() => () => judges.dispose())

  const ingest = new IngestService(db)
  // The model's graph and harvest changes reach the browser half through this feed.
  const flowEvents = new FlowEvents()

  host.skills?.registerProvider(control => createParallaxSkillProvider(control))
  if (host.tools !== undefined) {
    registerParallaxTool(host.tools, db)
    registerSetTool(host.tools, db, judges, flowEvents, dshJobs)
    registerIngestTool(host.tools, db, ingest, settings, flowEvents, dshJobs)
  }
  registerSetRoutes(host.connection.fetch, db, judges, settings, flowEvents)
  registerIngestRoutes(host.connection.fetch, db, ingest)
}
