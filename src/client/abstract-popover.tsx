/**
 * Title hover → abstract card: a 26rem rounded card below the title with an
 * uppercase "Abstract" label and a scrollable body. It opens after 300ms and
 * closes 180ms after the pointer leaves both the title and the card, so
 * moving across the gap never drops it.
 *
 * Member pages already carry the abstract, so nothing is fetched. The card is
 * portalled into <body> (outside `.pg-root`), so it carries its own color
 * tokens.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Translate } from './i18n.ts'

const OPEN_MS = 300
const CLOSE_MS = 180
const OFFSET = 6
const WIDTH = 416
const MARGIN = 8

interface Placement {
  left: number
  top?: number
  bottom?: number
}

export function AbstractPopover({ abstract, tr, children }: { abstract: string, tr: Translate, children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  // Title and card each count +1/-1; only when neither is hovered does it close.
  const hoverCount = useRef(0)

  useEffect(() => () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  // Scrolling the list moves the title away from a fixed card: close it.
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => {
      if (card.current?.contains(event.target as Node) === true) return
      hoverCount.current = 0
      setOpen(false)
    }
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('scroll', close, true) }
  }, [open])

  // Below the title, start-aligned; flip above when the card does not fit.
  useLayoutEffect(() => {
    if (!open || anchor.current === null) { setPlacement(null); return }
    const rect = anchor.current.getBoundingClientRect()
    const height = card.current?.offsetHeight ?? 0
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - WIDTH - MARGIN))
    const below = rect.bottom + OFFSET + height <= window.innerHeight - MARGIN || rect.top < window.innerHeight / 2
    setPlacement(below ? { left, top: rect.bottom + OFFSET } : { left, bottom: window.innerHeight - rect.top + OFFSET })
  }, [open])

  const scheduleOpen = (): void => {
    hoverCount.current += 1
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (openTimer.current === null) {
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null
        setOpen(true)
      }, OPEN_MS)
    }
  }
  const scheduleClose = (): void => {
    hoverCount.current = Math.max(0, hoverCount.current - 1)
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (hoverCount.current === 0 && closeTimer.current === null) {
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null
        setOpen(false)
      }, CLOSE_MS)
    }
  }

  const text = abstract.trim()
  return (
    <>
      <span ref={anchor} className="pg-abstract-anchor" onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
        {children}
      </span>
      {open ? createPortal(
        <div
          ref={card}
          className="pg-abstract"
          role="tooltip"
          // Measured first (hidden), then placed: the flip needs the card's height.
          style={placement === null ? { visibility: 'hidden', left: 0, top: 0 } : placement}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
        >
          <p className="pg-abstract-label">{tr('abstract.label')}</p>
          {text === ''
            ? <p className="pg-abstract-empty">{tr('abstract.empty')}</p>
            : <p className="pg-abstract-body">{text}</p>}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
