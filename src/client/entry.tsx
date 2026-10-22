/**
 * Header entry: one split control — the Parallax brand mark on the left opens
 * History, the chevron opens the tab menu. Both halves sit inside a single
 * rounded outline separated by a full-height divider, matching the shell's own
 * header controls (28px tall, 1px border, 8px radius).
 *
 * The menu lists icon + label only; "About" sits below a separator and opens
 * the project site.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Database, History, Info, Settings } from 'lucide-react'
import { BrandMark } from './brand.tsx'
import { translator, type LocaleKey, type Translate } from './i18n.ts'

/** Menu destinations. The canvas is not one: it only opens from a History card. */
export type ParallaxTab = 'history' | 'ingest' | 'settings'

const ABOUT_URL = 'https://parallax.ink'

const MENU: Array<{ id: ParallaxTab, label: LocaleKey, icon: typeof History }> = [
  { id: 'history', label: 'tab.history', icon: History },
  { id: 'ingest', label: 'tab.ingest', icon: Database },
  { id: 'settings', label: 'tab.settings', icon: Settings },
]

export function SplitEntry({ onOpen, t }: { onOpen: (tab: ParallaxTab) => void, t?: (key: string) => string }): JSX.Element {
  const tr: Translate = translator(t)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number, right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      setPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })
    }
    setOpen(true)
  }

  return (
    <div className="pg-split" onPointerDown={event => event.stopPropagation()}>
      <button
        type="button"
        className="pg-split-main"
        title={tr('tab.graph')}
        aria-label={tr('tab.graph')}
        onClick={() => { onOpen('history') }}
      >
        <BrandMark size={14} />
      </button>
      <button
        ref={buttonRef}
        type="button"
        className="pg-split-chevron"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tr('menu.open')}
        onClick={toggle}
      >
        <ChevronDown size={13} aria-hidden />
      </button>

      {open && position !== null ? createPortal(
        <div
          className="pg-menu"
          role="menu"
          style={{ top: position.top, right: position.right }}
          onPointerDown={event => event.stopPropagation()}
        >
          {MENU.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className="pg-menu-item"
              onClick={() => { setOpen(false); onOpen(id) }}
            >
              <Icon size={14} aria-hidden />
              <span className="pg-menu-label">{tr(label)}</span>
            </button>
          ))}
          <span className="pg-menu-separator" aria-hidden />
          <a
            className="pg-menu-item"
            role="menuitem"
            href={ABOUT_URL}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => setOpen(false)}
          >
            <Info size={14} aria-hidden />
            <span className="pg-menu-label">{tr('menu.about')}</span>
          </a>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
