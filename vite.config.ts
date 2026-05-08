import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    environment: 'node',
  },
  build: {
    target: 'es2022',
  },
  // Hardware QR tests may use the Mac's Bonjour hostname
  // (e.g. Antonios-MacBook-Pro.local) when direct LAN IP scanning fails.
  // Keep this scoped to Vite preview/dev only; production broker auth/origin
  // gates remain separate in src/asr/tokenBrokerServer.ts.
  server: {
    allowedHosts: ['.local'],
  },
  preview: {
    allowedHosts: ['.local'],
  },
})
