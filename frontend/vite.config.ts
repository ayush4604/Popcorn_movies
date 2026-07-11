import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const backendTarget = 'http://localhost:3001'
const frontendRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: frontendRoot,
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/cdn': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/vlc': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
})
