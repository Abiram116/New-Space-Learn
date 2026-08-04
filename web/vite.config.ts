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
})
