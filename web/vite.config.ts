/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Env files live at the repo root, shared with the API. */
const ENV_DIR = path.resolve(__dirname, '..')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), preconnectOrigins()],
  // One .env at the repo root feeds both apps (the API reads the same file).
  // Without this Vite only looks in web/, and every VITE_* var comes back
  // undefined even though the file is sitting right there.
  envDir: ENV_DIR,
  test: {
    // Node by default, jsdom opted into per file with a
    // `// @vitest-environment jsdom` docblock.
    //
    // The suite is overwhelmingly pure logic — parsing, scheduling, policy —
    // and paying jsdom's setup cost on every one of those files to serve the
    // handful that mount a component is the wrong default. (Vitest 4 removed
    // `environmentMatchGlobs`; the docblock is the supported way to do this
    // without splitting the suite into projects.)
    environment: 'node',
    setupFiles: ['./src/testSetup.ts'],
  },
})

/**
 * Emit `<link rel="preconnect">` for the origins the app actually talks to.
 *
 * Every signed-in load hits two third-party hosts before it can render: the
 * Supabase auth endpoint and the API. Each costs DNS + TCP + TLS on a cold
 * connection — a couple of hundred milliseconds on mobile, paid serially with
 * bundle parsing because nothing has told the browser those hosts exist yet.
 *
 * Read from the same env vars the client reads rather than hardcoded, so this
 * cannot quietly point at an origin the app stopped using — a stale preconnect
 * is a wasted connection, and nothing would fail loudly enough to catch it.
 */
function preconnectOrigins(): Plugin {
  return {
    name: 'space-learn-preconnect',
    transformIndexHtml(html, ctx) {
      // `envDir: '..'` above — the env files live at the repo root, not in
      // `web/`. Loading from `process.cwd()` found nothing and silently
      // emitted no hints, which is the failure mode worth guarding: a
      // preconnect that does not exist looks exactly like one that does.
      const env = loadEnv(ctx.server?.config.mode ?? 'production', ENV_DIR, '')
      const origins = [env.VITE_SUPABASE_URL, env.VITE_API_URL]
        .map((url) => {
          try {
            return url ? new URL(url).origin : null
          } catch {
            return null
          }
        })
        .filter((o): o is string => Boolean(o))
      const tags = [...new Set(origins)]
        .map((o) => `<link rel="preconnect" href="${o}" crossorigin />`)
        .join('\n    ')
      return html.replace('%VITE_PRECONNECT%', tags)
    },
  }
}
