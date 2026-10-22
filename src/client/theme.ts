/**
 * Runtime theme signal.
 *
 * The shell is built from CSS modules with hardcoded colors: it exposes neither
 * a `dark` class nor `--background`-style tokens, and its light/dark choice is
 * not necessarily the OS preference. So the plugin derives the theme from the
 * painted background and publishes it as `html[data-pgt="light"|"dark"]`, which
 * every scoped stylesheet rule keys off.
 */

export type Theme = 'light' | 'dark'

function luminance(color: string): number | null {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(color)
  if (match === null) return null
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if (alpha < 0.1) return null
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Read the theme from what the shell actually painted, not from the OS. */
function detectTheme(): Theme {
  for (const element of [document.body, document.documentElement]) {
    const value = luminance(getComputedStyle(element).backgroundColor)
    if (value !== null) return value < 0.5 ? 'dark' : 'light'
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Publish the theme on `<html>` and keep it current across shell theme changes
 * (attribute/class mutations) and OS-level preference changes.
 */
export function installThemeSignal(): () => void {
  const root = document.documentElement
  const apply = (): void => { root.setAttribute('data-pgt', detectTheme()) }
  apply()

  const query = matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', apply)

  const observer = new MutationObserver(apply)
  const options: MutationObserverInit = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] }
  observer.observe(root, options)
  if (document.body !== null) observer.observe(document.body, options)

  // Safety net: some surfaces repaint without touching attributes.
  const timer = setInterval(apply, 1500)

  return () => {
    query.removeEventListener('change', apply)
    observer.disconnect()
    clearInterval(timer)
    root.removeAttribute('data-pgt')
  }
}
