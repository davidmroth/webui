import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.svg', 'mask-icon.svg'],
      manifest: {
        name: 'Hermes WebUI',
        short_name: 'Hermes',
        description: 'Hermes web interface with installable offline-capable experience.',
        theme_color: '#1d4ed8',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          },
          {
            src: 'mask-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        importScripts: ['sw-notifications.js'],
        navigateFallback: null,
        navigateFallbackDenylist: [/^\/api\//]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  ssr: {
    noExternal: ['@lucide/svelte']
  }
});
