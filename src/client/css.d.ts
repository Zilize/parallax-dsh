/**
 * `import css from './x.css'` yields the compiled text (esbuild `text` loader),
 * which `apply()` injects as one plugin-owned <style> tag.
 */
declare module '*.css' {
  const cssText: string
  export default cssText
}
