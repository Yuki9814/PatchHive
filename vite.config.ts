import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function environmentCsp() {
  return {
    name: 'patchhive-environment-csp',
    transformIndexHtml(html: string, context: { server?: unknown }) {
      const connectSource = context.server
        ? "'self' ws://localhost:* ws://127.0.0.1:*"
        : "'none'"
      const styleSource = context.server ? "'self' 'unsafe-inline'" : "'self'"

      return html
        .replace('__PATCHHIVE_CONNECT_SRC__', connectSource)
        .replace('__PATCHHIVE_STYLE_SRC__', styleSource)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), environmentCsp()],
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
