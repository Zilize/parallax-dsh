/**
 * Floating hover tip: a black rounded box drawn into <body> (so scroll
 * containers never clip it), shown above the anchor.
 * Same look as the paper-row tips, but anchored by the hovered element's rect
 * instead of a pseudo-element, which keeps grid cells unwrapped.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'

interface TipState {
  label: string
  left: number
  top: number
}

export function useTip(): {
  tip: TipState | null
  bind: (label: string) => {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void
    onPointerLeave: () => void
    onFocus: (event: React.FocusEvent<HTMLElement>) => void
    onBlur: () => void
  }
  clear: () => void
} {
  const [tip, setTip] = useState<TipState | null>(null)

  const place = (element: HTMLElement, label: string): void => {
    const rect = element.getBoundingClientRect()
    setTip({ label, left: rect.left + rect.width / 2, top: rect.top })
  }

  return {
    tip,
    clear: () => setTip(null),
    bind: (label: string) => ({
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => place(event.currentTarget, label),
      onPointerLeave: () => setTip(null),
      onFocus: (event: React.FocusEvent<HTMLElement>) => place(event.currentTarget, label),
      onBlur: () => setTip(null),
    }),
  }
}

export function TipLayer({ tip }: { tip: TipState | null }): JSX.Element | null {
  if (tip === null) return null
  // Keep the box on screen: flip below when there is no room above.
  const below = tip.top < 48
  const style = {
    left: tip.left,
    top: below ? tip.top + 28 : tip.top - 6,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  }
  return createPortal(<div className="pg-tipbox" style={style} role="tooltip">{tip.label}</div>, document.body)
}
