import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config. In dev, proxy /api to the backend so the frontend and
// backend share an origin (mirrors the Nginx setup in production).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Split large third-party libraries into their own cacheable chunks so the
    // initial app bundle stays small and pages become interactive faster. The
    // heavy charting/animation libs load only on the routes that use them.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'chart-vendor': ['recharts'],
          'motion-vendor': ['framer-motion'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
})
