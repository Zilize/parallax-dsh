/**
 * Parallax — browser half.
 *
 * Registers four right-sidebar tabs and one header entry, and wires the
 * plugin's dictionaries into the shell's locale service (English fallback):
 *
 *  - History: the list of set flows, one per conversation that built sets;
 *  - Ingest: the year coverage calendar and the harvest dialog;
 *  - Build graph: one flow's graph and member lists, opened from History or
 *    automatically when the model creates a conversation's first node;
 *  - Settings: the arXiv category scope, the Jev API key and the proxy.
 */

import type { ComponentType } from 'react'
// React Flow's base styles plus the plugin's own scoped stylesheet.
import flowCss from '@xyflow/react/dist/style.css'
import paneCss from './styles.css'
import { ParallaxPane } from './pane.tsx'
import { IngestPane } from './ingest-pane.tsx'
import { HistoryPane } from './history-pane.tsx'
import { SettingsPane } from './settings-pane.tsx'
import { viewedFlow, type FlowSummary } from './sets-api.ts'
import { SplitEntry, type ParallaxTab } from './entry.tsx'
import { registerSkillCommand } from './skill-command.tsx'
import { DICTIONARIES, NS, translator, type LocaleKey } from './i18n.ts'
import { installThemeSignal } from './theme.ts'
import { watchAutoOpen, type MountedSession } from './auto-open.ts'
import { focusIngest } from './ingest-api.ts'
import { setLinkOpener } from './links.ts'

/** The canvas tab's kind, opened programmatically rather than from the menu. */
const CANVAS_KIND = 'parallax'
const BRAND = 'Parallax'
/** Slot registration retries while the owning package has not declared the slot yet. */
const SLOT_RETRY_MS = 50
const SLOT_MAX_ATTEMPTS = 100

interface ClientContext {
  effect(fn: () => () => void): void
  slots: {
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  sidebarRightTabs: {
    register(definition: { id: string, kind: string, priority: string, title: () => string }): () => void
  }
  sidebarRight: {
    openTab(kind: string, options?: unknown): void
    /** The conversation on screen (a snapshot store); absent in older shells. */
    mounted?: MountedSession
  }
  locale: {
    register(ns: string, dictionaries: { zh: Record<string, string>, en: Record<string, string> }): () => void
    bind?(ns: string): (key: string) => string
  }
  commandUi: {
    register(contribution: Record<string, unknown>): () => void
  }
  sessions: {
    scope(sessionId: string): unknown
  }
  get(name: string): unknown
}

/**
 * Cordis requires every consumed service to be declared: reaching
 * `ctx.slots` / `ctx.locale` without this list throws
 * `cannot get property "<key>" without inject`.
 */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale', 'commandUi', 'sessions']

/**
 * Client plugin body.
 *
 * A throwing client plugin aborts the entire web boot and the aggregate error
 * hides the cause, so failures are caught and logged here instead.
 */
export function apply(ctx: ClientContext): void {
  try {
    setup(ctx)
  } catch (error) {
    console.error('[parallax] apply failed:', error)
  }
}

/**
 * Register into a slot owned by another package. `register` throws while the
 * key is still undeclared, and entry creation order is not an activation
 * order, so retry briefly rather than failing this entry.
 */
function mountSlot(ctx: ClientContext, options: Record<string, unknown>, component: unknown): () => void {
  let dispose: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0

  const attempt = (): void => {
    try {
      dispose = ctx.slots.register(options, component)
    } catch (error) {
      attempts += 1
      if (attempts <= SLOT_MAX_ATTEMPTS) {
        timer = setTimeout(attempt, SLOT_RETRY_MS)
        return
      }
      console.error('[parallax] slot registration failed:', options.name, error)
    }
  }

  attempt()
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    dispose?.()
  }
}

/** Tab titles read `"{page} - Parallax"`. */
const withBrand = (page: string): string => `${page} - ${BRAND}`

/** Keyed tab-title component: keeps the chip in sync with the active locale. */
function tabTitle(key: LocaleKey): ComponentType<{ t?: (k: string) => string }> {
  return function Title({ t }) {
    return <>{withBrand(translator(t)(key))}</>
  }
}

interface TabSpec {
  id: string
  kind: string
  title: LocaleKey
  pane: unknown
}

function setup(ctx: ClientContext): void {
  // Dictionaries: the shell picks by its own language setting, English fallback.
  // A rejected registration must not fail the plugin: components then fall
  // back to the dictionary matching `<html lang>`.
  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, DICTIONARIES)
    } catch (error) {
      console.error('[parallax] locale registration failed:', error)
      return () => {}
    }
  })

  // One stylesheet for the whole plugin; removing the tag on unload keeps the
  // page clean when the user disables it.
  const style = document.createElement('style')
  style.dataset.plugin = BRAND
  style.textContent = `${flowCss}\n${paneCss}`
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove())

  // Publish `html[data-pgt]` so every scoped rule follows the shell's theme
  // (the shell exposes neither a dark class nor color tokens).
  ctx.effect(() => installThemeSignal())

  // `bind` is optional in older shells: without it titles fall back to the
  // dictionary for `<html lang>`, while slot-rendered copy uses the injected `t`.
  const bound = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : undefined
  const tr = translator(bound)

  const MENU_KINDS: Record<ParallaxTab, string> = {
    history: 'parallaxHistory',
    ingest: 'parallaxIngest',
    settings: 'parallaxSettings',
  }
  const open = (tab: ParallaxTab): void => { ctx.sidebarRight.openTab(MENU_KINDS[tab]) }
  const openFlow = (flowId: string): void => {
    viewedFlow.set(flowId)
    ctx.sidebarRight.openTab(CANVAS_KIND)
  }

  const tabs: TabSpec[] = [
    {
      id: 'Parallax/history',
      kind: MENU_KINDS.history,
      title: 'tab.history',
      pane: (props: Record<string, unknown>) => <HistoryPane {...props} onOpenFlow={(flow: FlowSummary) => { openFlow(flow.id) }} />,
    },
    {
      id: 'Parallax/ingest',
      kind: MENU_KINDS.ingest,
      title: 'tab.ingest',
      pane: (props: Record<string, unknown>) => <IngestPane {...props} onOpenSettings={() => { open('settings') }} />,
    },
    { id: 'Parallax/canvas', kind: CANVAS_KIND, title: 'tab.canvas', pane: ParallaxPane },
    { id: 'Parallax/settings', kind: MENU_KINDS.settings, title: 'tab.settings', pane: SettingsPane },
  ]
  for (const tab of tabs) {
    ctx.effect(() => ctx.sidebarRightTabs.register({ id: tab.id, kind: tab.kind, priority: 'builtin', title: () => withBrand(tr(tab.title)) }))
    ctx.effect(() => mountSlot(ctx, { name: 'sidebar.right.pane.tab', key: tab.id, locale: NS }, tab.pane))
    ctx.effect(() => mountSlot(ctx, { name: 'sidebar.right.pane.tab.title', key: tab.id, locale: NS }, tabTitle(tab.title)))
  }

  ctx.effect(() => mountSlot(ctx, {
    name: 'conversation.session.header.utilities',
    id: 'parallax-entry',
    order: -1000,
    locale: NS,
    inject: () => ({ onOpen: open }),
  }, SplitEntry))

  // The model's first node opens the canvas on that flow, and a harvest it
  // starts opens the Ingest calendar on that run's last year, once the
  // conversation is on screen. `openTab` throws while no session is mounted.
  ctx.effect(() => watchAutoOpen(ctx.sidebarRight.mounted, (event) => {
    try {
      if (event.type === 'harvest-started') {
        focusIngest(Number(event.to.slice(0, 4)))
        open('ingest')
      } else {
        openFlow(event.flowId)
      }
    } catch (error) {
      console.error('[parallax] could not open a tab:', error)
    }
  }))

  // Paper links open in the shell's Browser tab (`browser` kind, `{ url }`).
  // A shell without it, or a Browser disabled in this profile, throws: the
  // link then falls back to its own `target="_blank"`.
  ctx.effect(() => {
    setLinkOpener((url) => {
      try {
        ctx.sidebarRight.openTab('browser', { params: { url } })
        return true
      } catch {
        return false
      }
    })
    return () => { setLinkOpener(undefined) }
  })

  // The research skill lives in the composer's "+" menu as a command
  // contribution; choosing it toggles `/parallax-skills` in the draft.
  registerSkillCommand(ctx, tr)
}
