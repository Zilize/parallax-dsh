/**
 * Jev and network settings. The API key is a secret, so it lives in the host
 * credential store (`ctx.credentials`, the user's private credentials file)
 * under one reference name and never in the plugin database; an environment
 * variable of the same name stands in when no store is available. Base URL,
 * model, request concurrency and batch size, and the outbound proxy (see
 * ./ingest/network.ts) are plain settings.
 */

import type { DatabaseSync } from 'node:sqlite'

import { readSetting, writeSetting } from './ingest/db.ts'
import { describeProxy, maskProxyUrl, normalizeProxyUrl, type ProxyView } from './ingest/network.ts'
import {
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_BATCH_SIZE,
  DEFAULT_JEV_CONCURRENCY,
  DEFAULT_JEV_MODEL,
  JEV_KEY_REF,
  MAX_JEV_BATCH_SIZE,
  MAX_JEV_CONCURRENCY,
} from './jev-defaults.ts'
import type { JevRuntime } from './sets/jev.ts'

const BASE_URL_KEY = 'jev.base_url'
const MODEL_KEY = 'jev.model'
const CONCURRENCY_KEY = 'jev.concurrency'
const BATCH_SIZE_KEY = 'jev.batch_size'
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
  concurrency: number
  batchSize: number
}

export interface JevSettingsChange {
  /** `null` or blank removes the stored key. */
  apiKey?: string | null
  /** `null` or blank restores the default. */
  baseUrl?: string | null
  model?: string | null
  /** `null` restores the default. */
  concurrency?: number | null
  batchSize?: number | null
}

/** A tunable integer and the range it accepts. */
interface Tunable {
  key: string
  label: string
  fallback: number
  max: number
}

const CONCURRENCY: Tunable = { key: CONCURRENCY_KEY, label: 'concurrency', fallback: DEFAULT_JEV_CONCURRENCY, max: MAX_JEV_CONCURRENCY }
const BATCH_SIZE: Tunable = { key: BATCH_SIZE_KEY, label: 'batch size', fallback: DEFAULT_JEV_BATCH_SIZE, max: MAX_JEV_BATCH_SIZE }

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

  /** A saved tunable, or its default when unset or out of range. */
  private tunable(spec: Tunable): number {
    const value = Number(readSetting(this.db, spec.key))
    return Number.isInteger(value) && value >= 1 && value <= spec.max ? value : spec.fallback
  }

  private writeTunable(spec: Tunable, value: number | null): void {
    if (value !== null && !(Number.isInteger(value) && value >= 1 && value <= spec.max)) {
      throw new Error(`${spec.label} must be a whole number from 1 to ${spec.max}`)
    }
    writeSetting(this.db, spec.key, value === null ? undefined : String(value))
  }

  /** Base URL, model and tuning: everything but the key. */
  private plain(): Omit<JevSettingsView, 'configured' | 'source' | 'writable'> {
    return { baseUrl: this.baseUrl(), model: this.model(), concurrency: this.tunable(CONCURRENCY), batchSize: this.tunable(BATCH_SIZE) }
  }

  /** Resolve the key per call, so a rotated key reaches the very next request. */
  async runtime(): Promise<JevRuntime | undefined> {
    const store = this.credentials()
    const apiKey = store === undefined ? ambientKey() : (await store.resolve(JEV_KEY_REF))?.value
    if (apiKey === undefined) return undefined
    return { apiKey, ...this.plain() }
  }

  async describe(): Promise<JevSettingsView> {
    const store = this.credentials()
    const base = this.plain()
    if (store === undefined) {
      const configured = ambientKey() !== undefined
      return { ...base, configured, writable: false, ...configured ? { source: 'env' } : {} }
    }
    const info = await store.describe(JEV_KEY_REF)
    return { ...base, configured: info.configured, writable: info.writable, ...info.source === undefined ? {} : { source: info.source } }
  }

  /** Apply a change; an omitted field is left as it is. */
  async update(change: JevSettingsChange): Promise<JevSettingsView> {
    // Validate the numbers first, so a bad value saves nothing.
    if (change.concurrency !== undefined) this.writeTunable(CONCURRENCY, change.concurrency)
    if (change.batchSize !== undefined) this.writeTunable(BATCH_SIZE, change.batchSize)
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
