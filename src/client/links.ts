/**
 * External paper links (arXiv abs / PDF / HTML) open in the shell's built-in
 * Browser tab when the shell provides one. `main.tsx` installs the opener;
 * without it, or when it fails, the anchor's own `target="_blank"` applies.
 */

import type { MouseEvent } from 'react'

type Opener = (url: string) => boolean

let opener: Opener | undefined

export function setLinkOpener(next: Opener | undefined): void {
  opener = next
}

/**
 * Click handler for an external anchor. A modified or non-primary click keeps
 * the browser default, so Ctrl/⌘-click still means "elsewhere".
 */
export function openInApp(event: MouseEvent<HTMLAnchorElement>): void {
  if (opener === undefined || event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (opener(event.currentTarget.href)) event.preventDefault()
}
