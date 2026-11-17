import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Tennis KPI Tracker',
        short_name: 'Tennis KPI',
        description: 'Live tennis scoring and KPI tracking',
        theme_color: '#16856b',
        background_color: '#edf1ec',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: { navigateFallback: '/index.html' }
    })
  ],
  test: { environment: 'jsdom', globals: true }
})
