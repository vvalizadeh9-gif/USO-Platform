import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The version UEP Home's footer shows, from package.json at build time.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Vite config. In dev, proxy /api to the backend so the frontend and
// backend share an origin (mirrors the Nginx setup in production).
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  // Vitest. jsdom because the tests that matter here touch the DOM and
  // localStorage; the pure modules would run in node, but splitting the suite
  // by environment costs more than it saves at this size.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
  build: {
    outDir: 'dist',
    // Split large third-party libraries into their own cacheable chunks so the
    // initial app bundle stays small and pages become interactive faster. The
    // animation library loads only on the routes that use it.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'motion-vendor': ['framer-motion'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
