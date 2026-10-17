import { defineConfig } from 'vite'

// Saat pengembangan, permintaan API dan data diteruskan ke server Node (server/index.ts).
// VITE_HOST=0.0.0.0 dan VITE_POLL=1 dipakai saat berjalan di container Podman.
const api = 'http://127.0.0.1:8787'

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/data': api },
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
  },
})
