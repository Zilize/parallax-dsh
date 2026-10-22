/**
 * Build both halves of the plugin.
 *
 * The browser half must satisfy the dsh client-module contract, which is a
 * convention rather than a framework import:
 *
 *   window.__ModuleLoader__.load({ id: "<package name>", factory: (require) => {
 *     var module = { exports: {} }; var exports = module.exports;
 *     …bundled CommonJS body…
 *     return module.exports;
 *   } });
 *
 * and every baseline module must stay a `require(...)` that the loader's table
 * answers. Bundling React would create a second React instance and break hooks.
 */
import { build, context } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const id = pkg.name
const watch = process.argv.includes('--watch')

/**
 * Mirrors PLATFORM_MODULES / the implicit baseline in the dsh Web shell
 * (`packages/client/web/src/platform.ts`). Keep this list in sync with the
 * dsh release you target.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Browser half: lazy CommonJS factory, externals resolved by the shell table. */
const client = {
  entryPoints: ['src/client/main.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  minify: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  // React Flow ships plain CSS; inline it and inject one <style> at runtime.
  loader: { '.css': 'text' },
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  logLevel: 'info',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
}

/** Node half: a normal ES module the Host Loader imports by package name. */
const host = {
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // node:* builtins and real dependencies stay imports; only our own code is bundled.
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
}

if (watch) {
  const contexts = await Promise.all([context(client), context(host)])
  await Promise.all(contexts.map(ctx => ctx.watch()))
  console.log('[parallax] watching src/ …')
} else {
  await Promise.all([build(client), build(host)])
}
