import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Development server configuration
  server: {
    port: 5173,
    host: true,
    // Proxy API requests to backend in development
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  // Production build configuration
  build: {
    outDir: 'dist',
    sourcemap: false,
    // rolldown-vite uses oxc for minification by default
    rollupOptions: {
      output: {
        // Use function syntax for rolldown-vite compatibility
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor';
            }
            if (id.includes('recharts')) {
              return 'charts';
            }
          }
        },
      },
    },
  },

  // Environment variable prefix
  envPrefix: 'VITE_',
})
