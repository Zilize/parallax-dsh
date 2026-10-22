/**
 * Outbound proxy for the arXiv harvest and Jev requests. Node's built-in
 * `fetch` ignores `HTTPS_PROXY`, so a user behind a local proxy (Clash,
 * v2rayN, …) silently connects direct: harvest pages crawl into the request
 * timeout and Jev answers HTTP 451 from blocked regions. Precedence:
 *
 *  1. the plugin setting `network.proxy` (Windows system proxies live in the
 *     registry, which Node never reads, so this is the way to name one);
 *  2. `HTTPS_PROXY` / `HTTP_PROXY`, honouring `NO_PROXY`, the convention
 *     curl, git and npm already follow;
 *  3. direct.
 *
 * Only harvest and Jev requests get the dispatcher: the plugin shares its
 * process with the host and other plugins, so the global dispatcher stays
 * untouched.
 */

import { EnvHttpProxyAgent, ProxyAgent, type Dispatcher } from 'undici'

export type ProxySource = 'setting' | 'env' | 'direct'

export interface ProxyView {
  /** The saved setting, credentials masked; null when unset. */
  setting: string | null
  /** The proxy harvest and Jev requests will use, credentials masked; null for direct. */
  effective: string | null
  source: ProxySource
  /** The environment variable that supplied the proxy, when `source` is `env`. */
  envName?: string
}

export interface OutboundNetwork {
  dispatcher: Dispatcher
  /** Short label for job progress and errors: a masked proxy URL or `direct`. */
  label: string
  close: () => Promise<void>
}

const ENV_NAMES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

/** Validate a user-entered proxy URL; `host:port` alone means `http://host:port`. */
export function normalizeProxyUrl(input: string): string {
  const raw = input.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('proxy must be a URL like http://127.0.0.1:7890')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`proxy scheme ${url.protocol.replace(':', '')} is not supported; use the HTTP port of your proxy (http://…)`)
  }
  if (url.hostname === '') throw new Error('proxy must name a host')
  return withScheme.replace(/\/+$/, '')
}

/** `http://user:pass@host:7890` → `http://***@host:7890`. */
export function maskProxyUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.username === '' && url.password === '') return value
    return `${url.protocol}//***@${url.host}`
  } catch {
    return value
  }
}

function envProxy(): { name: string, value: string } | null {
  for (const name of ENV_NAMES) {
    const value = (process.env[name] ?? '').trim()
    if (value !== '') return { name, value }
  }
  return null
}

export function describeProxy(setting: string | null): ProxyView {
  if (setting !== null) return { setting: maskProxyUrl(setting), effective: maskProxyUrl(setting), source: 'setting' }
  const env = envProxy()
  if (env !== null) return { setting: null, effective: maskProxyUrl(env.value), source: 'env', envName: env.name }
  return { setting: null, effective: null, source: 'direct' }
}

/** One dispatcher per harvest or judging run; the caller closes it when the run ends. */
export function openNetwork(setting: string | null): OutboundNetwork {
  const view = describeProxy(setting)
  // EnvHttpProxyAgent connects direct when no proxy variable is set, so it
  // covers both the env and the direct case.
  const dispatcher = setting !== null ? new ProxyAgent(setting) : new EnvHttpProxyAgent()
  return {
    dispatcher,
    label: view.effective ?? 'direct',
    close: async () => { await dispatcher.close().catch(() => {}) },
  }
}
