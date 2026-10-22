/**
 * Single-date field: an outline trigger button (calendar icon, tabular text)
 * that opens a month popover with 32px day cells. Month and weekday names
 * follow the UI locale.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { uiLocale } from './i18n.ts'

const PANEL = { width: 264, height: 316 }
/** 2023-01-01 was a Sunday: the seven days from it name the weekday columns. */
const FIRST_SUNDAY = Date.UTC(2023, 0, 1)

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function weekdayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, index) => format.format(FIRST_SUNDAY + index * 86_400_000))
}

interface Position {
  top: number
  left: number
  up: boolean
}

export function DateField({
  value,
  onChange,
  max,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  /** Latest selectable day (YYYY-MM-DD); later days render disabled. */
  max?: string
  placeholder: string
  ariaLabel: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const [month, setMonth] = useState<{ year: number, month: number }>(() => {
    const base = value === '' ? new Date() : new Date(`${value}T00:00:00`)
    return { year: base.getFullYear(), month: base.getMonth() }
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const locale = uiLocale()

  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const up = rect.bottom + PANEL.height > window.innerHeight - 12
    setPosition({
      top: up ? rect.top - PANEL.height - 6 : rect.bottom + 6,
      left: Math.min(Math.max(8, rect.left), window.innerWidth - PANEL.width - 8),
      up,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) === true) return
      if (triggerRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const grid = useMemo(() => {
    const first = new Date(month.year, month.month, 1)
    const days = new Date(month.year, month.month + 1, 0).getDate()
    const cells: Array<string | null> = Array.from({ length: first.getDay() }, () => null)
    for (let day = 1; day <= days; day += 1) cells.push(iso(month.year, month.month, day))
    return cells
  }, [month])

  const today = iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  const caption = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(month.year, month.month, 1))
  const weekdays = useMemo(() => weekdayNames(locale), [locale])

  const shift = (delta: number): void => {
    setMonth((current) => {
      const next = new Date(current.year, current.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pg-datefield"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <CalendarIcon size={14} className="pg-datefield-icon" aria-hidden />
        <span className={value === '' ? 'is-empty' : ''}>{value === '' ? placeholder : value}</span>
      </button>

      {open && position !== null ? (
        <div
          ref={panelRef}
          className="pg-calpop"
          role="dialog"
          aria-label={ariaLabel}
          style={{ top: position.top, left: position.left }}
        >
          <div className="pg-calpop-head">
            <span>{caption}</span>
            <div className="pg-calpop-nav">
              <button type="button" aria-label="prev" onClick={() => shift(-1)}>
                <ChevronLeft size={16} aria-hidden />
              </button>
              <button type="button" aria-label="next" onClick={() => shift(1)}>
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          </div>
          <div className="pg-calpop-weekdays">
            {weekdays.map((name, index) => <span key={index}>{name}</span>)}
          </div>
          <div className="pg-calpop-days">
            {grid.map((day, index) => {
              if (day === null) return <span key={`blank-${index}`} />
              const disabled = max !== undefined && day > max
              return (
                <button
                  key={day}
                  type="button"
                  className={['pg-calpop-day', day === value ? 'is-selected' : '', day === today ? 'is-today' : ''].filter(Boolean).join(' ')}
                  disabled={disabled}
                  onClick={() => { onChange(day); setOpen(false) }}
                >
                  {Number(day.slice(8, 10))}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </>
  )
}
