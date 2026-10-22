/**
 * Settings: three cards with the same layout.
 *
 *  - arXiv categories: the harvest scope, saved on every change (the Ingest
 *    calendar measures coverage against it); empty until the user picks one;
 *  - Jev: the API key is stored in the host's credential file, and the
 *    browser only learns whether one is configured, where it comes from and
 *    whether it can be changed — never the key itself. A key supplied by the
 *    environment is read-only here;
 *  - Network: the proxy shared by harvests and Jev requests. Left empty, it
 *    falls back to HTTPS_PROXY / HTTP_PROXY, then to a direct connection; the
 *    card header shows which layer is in effect.
 */

import { useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import {
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_BATCH_SIZE,
  DEFAULT_JEV_CONCURRENCY,
  DEFAULT_JEV_MODEL,
  JEV_KEY_REF,
  MAX_JEV_BATCH_SIZE,
  MAX_JEV_CONCURRENCY,
} from '../jev-defaults.ts'
import { loadSettings, saveJevSettings, saveProxy, type JevSettingsView, type NetworkView } from './sets-api.ts'
import { loadCategories, saveCategories } from './ingest-api.ts'
import { CategoryEditor } from './category-editor.tsx'
import { errorMessage } from './http.ts'
import { translator, type Translate } from './i18n.ts'

type Message = { error: boolean, text: string } | null

/** An input's text for a setting: empty while the default applies, so the placeholder shows it. */
const shown = <T,>(value: T, fallback: T): string => (value === fallback ? '' : String(value))
/** Empty restores the default; anything else goes to the host, which validates it. */
const countOf = (text: string): number | null => (text.trim() === '' ? null : Number(text))

function Status({ ok, label }: { ok: boolean, label: string }): JSX.Element {
  return (
    <span className={ok ? 'pg-status is-ok' : 'pg-status'}>
      {ok ? <CircleCheck size={13} aria-hidden /> : <CircleAlert size={13} aria-hidden />}
      {label}
    </span>
  )
}

function SaveMessage({ message }: { message: Message }): JSX.Element | null {
  if (message === null) return null
  return <span className={message.error ? 'pg-settings-msg is-error' : 'pg-settings-msg'}>{message.text}</span>
}

/** Busy flag and result message around one save at a time. */
function useSave(tr: Translate): { busy: boolean, message: Message, run: <T>(work: () => Promise<T>, then: (result: T) => void) => void } {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const run = <T,>(work: () => Promise<T>, then: (result: T) => void): void => {
    setBusy(true)
    setMessage(null)
    work()
      .then((result) => {
        then(result)
        setMessage({ error: false, text: tr('settings.saved') })
      })
      .catch((reason: unknown) => { setMessage({ error: true, text: errorMessage(reason) }) })
      .finally(() => { setBusy(false) })
  }
  return { busy, message, run }
}

function CategoriesCard({ tr }: { tr: Translate }): JSX.Element {
  const [categories, setCategories] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Saves run in order; only the newest one's failure is worth showing.
  const latest = useRef(0)

  useEffect(() => {
    loadCategories().then(setCategories).catch((reason: unknown) => { setError(errorMessage(reason)) })
  }, [])

  const change = (next: string[]): void => {
    setCategories(next)
    setError(null)
    const ticket = ++latest.current
    saveCategories(next).catch((reason: unknown) => { if (ticket === latest.current) setError(errorMessage(reason)) })
  }

  const count = categories?.length ?? 0
  return (
    <section className="pg-section">
      <header className="pg-head">
        <h2>{tr('settings.categories')}</h2>
        {categories === null ? null : <Status ok={count > 0} label={count > 0 ? tr('ingest.categoryCount', { count }) : tr('ingest.emptyCategories')} />}
      </header>
      <div className="pg-panel pg-settings-card">
        {categories === null
          ? <p className="pg-meta">{tr('ingest.loading')}</p>
          : <CategoryEditor categories={categories} onChange={change} tr={tr} />}
        {count === 0 ? null : (
          <div className="pg-settings-actions">
            <button type="button" className="pg-btn pg-btn-quiet" onClick={() => { change([]) }}>{tr('ingest.clear')}</button>
          </div>
        )}
        {error === null ? null : <p className="pg-error">{error}</p>}
      </div>
    </section>
  )
}

function JevCard({ initial, tr }: { initial: JevSettingsView, tr: Translate }): JSX.Element {
  const [view, setView] = useState(initial)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(shown(initial.baseUrl, DEFAULT_JEV_BASE_URL))
  const [model, setModel] = useState(shown(initial.model, DEFAULT_JEV_MODEL))
  const [concurrency, setConcurrency] = useState(shown(initial.concurrency, DEFAULT_JEV_CONCURRENCY))
  const [batchSize, setBatchSize] = useState(shown(initial.batchSize, DEFAULT_JEV_BATCH_SIZE))
  const { busy, message, run } = useSave(tr)

  const save = (change: Parameters<typeof saveJevSettings>[0]): void => {
    run(async () => await saveJevSettings(change), (next) => {
      setView(next)
      setBaseUrl(shown(next.baseUrl, DEFAULT_JEV_BASE_URL))
      setModel(shown(next.model, DEFAULT_JEV_MODEL))
      setConcurrency(shown(next.concurrency, DEFAULT_JEV_CONCURRENCY))
      setBatchSize(shown(next.batchSize, DEFAULT_JEV_BATCH_SIZE))
      setApiKey('')
    })
  }

  const envOnly = view.configured && !view.writable

  return (
    <section className="pg-section">
      <header className="pg-head">
        <h2>{tr('settings.jev')}</h2>
        <Status ok={view.configured} label={view.configured ? tr('settings.configured', { source: view.source ?? '' }) : tr('settings.missing')} />
      </header>
      <div className="pg-panel pg-settings-card">
        <p className="pg-settings-lead">{tr('settings.jevHint')}</p>

        <label className="pg-field">
          <span>{tr('settings.key')}</span>
          {envOnly ? (
            <span className="pg-settings-readonly">{tr('settings.readonly', { name: JEV_KEY_REF })}</span>
          ) : (
            <input
              className="pg-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={view.configured ? tr('settings.keyPlaceholder') : 'sk-…'}
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
            />
          )}
        </label>
        <div className="pg-field-row">
          <label className="pg-field">
            <span>{tr('settings.baseUrl')}</span>
            <input className="pg-input" type="url" spellCheck={false} placeholder={DEFAULT_JEV_BASE_URL} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} />
          </label>
          <label className="pg-field">
            <span>{tr('settings.model')}</span>
            <input className="pg-input" type="text" spellCheck={false} placeholder={DEFAULT_JEV_MODEL} value={model} onChange={event => setModel(event.target.value)} />
          </label>
        </div>
        <div className="pg-field-row">
          <label className="pg-field">
            <span>{tr('settings.concurrency')}</span>
            <input className="pg-input" type="number" min={1} max={MAX_JEV_CONCURRENCY} step={1} placeholder={String(DEFAULT_JEV_CONCURRENCY)} value={concurrency} onChange={event => setConcurrency(event.target.value)} />
          </label>
          <label className="pg-field">
            <span>{tr('settings.batchSize')}</span>
            <input className="pg-input" type="number" min={1} max={MAX_JEV_BATCH_SIZE} step={1} placeholder={String(DEFAULT_JEV_BATCH_SIZE)} value={batchSize} onChange={event => setBatchSize(event.target.value)} />
          </label>
        </div>
        <p className="pg-hint">{tr('settings.tuningHint', { concurrency: MAX_JEV_CONCURRENCY, batch: MAX_JEV_BATCH_SIZE })}</p>

        <div className="pg-settings-actions">
          <SaveMessage message={message} />
          {view.configured && view.writable ? (
            <button type="button" className="pg-btn" disabled={busy} onClick={() => { save({ apiKey: null }) }}>
              {tr('settings.clear')}
            </button>
          ) : null}
          <button
            type="button"
            className="pg-btn pg-btn-primary"
            disabled={busy}
            onClick={() => {
              save({
                ...apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() },
                baseUrl: baseUrl.trim() === '' ? null : baseUrl.trim(),
                model: model.trim() === '' ? null : model.trim(),
                concurrency: countOf(concurrency),
                batchSize: countOf(batchSize),
              })
            }}
          >
            {tr('settings.save')}
          </button>
        </div>
      </div>
    </section>
  )
}

function NetworkCard({ initial, tr }: { initial: NetworkView, tr: Translate }): JSX.Element {
  const [view, setView] = useState(initial)
  const [proxy, setProxy] = useState(initial.setting ?? '')
  const { busy, message, run } = useSave(tr)

  const save = (value: string | null): void => {
    run(async () => await saveProxy(value), (next) => {
      setView(next)
      setProxy(next.setting ?? '')
    })
  }

  const status = view.source === 'setting'
    ? <Status ok label={tr('settings.proxyActive', { proxy: view.effective ?? '' })} />
    : view.source === 'env'
      ? <Status ok label={tr('settings.proxyFromEnv', { name: view.envName ?? '', proxy: view.effective ?? '' })} />
      // Direct is a valid choice, not a warning: no icon.
      : <span className="pg-status">{tr('settings.proxyDirect')}</span>

  return (
    <section className="pg-section">
      <header className="pg-head">
        <h2>{tr('settings.network')}</h2>
        {status}
      </header>
      <div className="pg-panel pg-settings-card">
        <p className="pg-settings-lead">{tr('settings.networkHint')}</p>

        <label className="pg-field">
          <span>{tr('settings.proxy')}</span>
          <input
            className="pg-input"
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder={view.source === 'env' ? (view.effective ?? '') : 'http://127.0.0.1:7890'}
            value={proxy}
            onChange={event => setProxy(event.target.value)}
          />
        </label>

        <div className="pg-settings-actions">
          <SaveMessage message={message} />
          <button
            type="button"
            className="pg-btn pg-btn-primary"
            disabled={busy}
            onClick={() => { save(proxy.trim() === '' ? null : proxy.trim()) }}
          >
            {tr('settings.save')}
          </button>
        </div>
      </div>
    </section>
  )
}

export function SettingsPane({ t }: { t?: (key: string) => string }): JSX.Element {
  const tr = translator(t)
  const [settings, setSettings] = useState<{ jev: JevSettingsView, network: NetworkView } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadSettings().then(setSettings).catch((reason: unknown) => { setError(errorMessage(reason)) })
  }, [])

  return (
    <div className="pg-root pg-settings">
      <div className="pg-col">
        <CategoriesCard tr={tr} />
        {error === null ? null : <p className="pg-error">{error}</p>}
        {settings === null ? null : (
          <>
            <JevCard initial={settings.jev} tr={tr} />
            <NetworkCard initial={settings.network} tr={tr} />
          </>
        )}
      </div>
    </div>
  )
}
