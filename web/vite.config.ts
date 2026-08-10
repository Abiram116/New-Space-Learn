/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env at the repo root feeds both apps (the API reads the same file).
  // Without this Vite only looks in web/, and every VITE_* var comes back
  // undefined even though the file is sitting right there.
  envDir: '..',
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
  },
})
