/**
 * Jev and network settings. The API key is a secret, so it lives in the host
 * credential store (`ctx.credentials`, the user's private credentials file)
 * under one reference name and never in the plugin database; an environment
 * variable of the same name stands in when no store is available. Base URL,
 * model and the outbound proxy (see ./ingest/network.ts) are plain settings.
 */

import type { DatabaseSync } from 'node:sqlite'

import { readSetting, writeSetting } from './ingest/db.ts'
import { describeProxy, maskProxyUrl, normalizeProxyUrl, type ProxyView } from './ingest/network.ts'
import { DEFAULT_JEV_BASE_URL, DEFAULT_JEV_MODEL, JEV_KEY_REF } from './jev-defaults.ts'
import type { JevRuntime } from './sets/jev.ts'

const BASE_URL_KEY = 'jev.base_url'
const MODEL_KEY = 'jev.model'
const PROXY_KEY = 'network.proxy'

/** The slice of `ctx.credentials` this plugin uses (the reference is a plain env-var name). */
export interface CredentialStore {
  resolve(ref: string): Promise<{ value: string, source: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean, source?: string, writable: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

export interface JevSettingsView {
  configured: boolean
  /** Which layer supplies the key (`file`, `env`, …); absent while unconfigured. */
  source?: string
  /** False when the key comes from the process environment or no store is available. */
  writable: boolean
  baseUrl: string
  model: string
}

export interface JevSettingsChange {
  /** `null` or blank removes the stored key. */
  apiKey?: string | null
  /** `null` or blank restores the default. */
  baseUrl?: string | null
  model?: string | null
}

function ambientKey(): string | undefined {
  const value = process.env[JEV_KEY_REF]
  return value === undefined || value === '' ? undefined : value
}

export class JevSettings {
  constructor(
    private readonly db: DatabaseSync,
    /** Looked up per operation: the credential service may come and go with its plugin. */
    private readonly credentials: () => CredentialStore | undefined,
  ) {}

  private baseUrl(): string {
    return readSetting(this.db, BASE_URL_KEY) ?? DEFAULT_JEV_BASE_URL
  }

  private model(): string {
    return readSetting(this.db, MODEL_KEY) ?? DEFAULT_JEV_MODEL
  }

  /** Resolve the key per call, so a rotated key reaches the very next request. */
  async runtime(): Promise<JevRuntime | undefined> {
    const store = this.credentials()
    const apiKey = store === undefined ? ambientKey() : (await store.resolve(JEV_KEY_REF))?.value
    if (apiKey === undefined) return undefined
    return { apiKey, baseUrl: this.baseUrl(), model: this.model() }
  }

  async describe(): Promise<JevSettingsView> {
    const store = this.credentials()
    const base = { baseUrl: this.baseUrl(), model: this.model() }
    if (store === undefined) {
      const configured = ambientKey() !== undefined
      return { ...base, configured, writable: false, ...configured ? { source: 'env' } : {} }
    }
    const info = await store.describe(JEV_KEY_REF)
    return { ...base, configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } }
  }

  /** Apply a change; an omitted field is left as it is. */
  async update(change: JevSettingsChange): Promise<JevSettingsView> {
    if (change.baseUrl !== undefined) {
      const value = change.baseUrl?.trim() ?? ''
      if (value !== '' && !/^https?:\/\/\S+$/.test(value)) throw new Error('base URL must be an http(s) URL')
      writeSetting(this.db, BASE_URL_KEY, value)
    }
    if (change.model !== undefined) writeSetting(this.db, MODEL_KEY, change.model ?? undefined)
    if (change.apiKey !== undefined) {
      const store = this.credentials()
      if (store === undefined) throw new Error(`no credential store is available; set the ${JEV_KEY_REF} environment variable instead`)
      const value = change.apiKey?.trim() ?? ''
      if (value === '') await store.unset(JEV_KEY_REF)
      else await store.set(JEV_KEY_REF, value)
    }
    return await this.describe()
  }
}

/** The saved proxy URL, or null to fall back to the environment. */
export function proxySetting(db: DatabaseSync): string | null {
  return readSetting(db, PROXY_KEY) ?? null
}

export function describeNetwork(db: DatabaseSync): ProxyView {
  return describeProxy(proxySetting(db))
}

/** `null` or a blank string clears the proxy. */
export function updateNetwork(db: DatabaseSync, change: { proxy?: string | null }): ProxyView {
  if (change.proxy !== undefined) {
    const value = change.proxy === null || change.proxy.trim() === '' ? undefined : normalizeProxyUrl(change.proxy)
    // The client only ever sees the masked form; saving it back unchanged
    // must keep the stored credentials, not replace them with `***`.
    const current = proxySetting(db)
    if (value === undefined || current === null || value !== maskProxyUrl(current)) writeSetting(db, PROXY_KEY, value)
  }
  return describeNetwork(db)
}
