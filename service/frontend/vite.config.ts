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
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'mask-icon.svg'],
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
            src: 'icon.png',
            sizes: '768x768',
            type: 'image/png'
          },
          {
            src: 'icon.png',
            sizes: '768x768',
            type: 'image/png',
            purpose: 'maskable any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg,woff2}'],
        importScripts: ['sw-notifications.js'],
        // This app is SSR-driven, so there is no precached app-shell index.html
        // for Workbox to serve as a navigation fallback.
        navigateFallback: undefined,
        navigateFallbackDenylist: [/^\/api\//]
      },
      devOptions: {
        // The generated Workbox service worker expects build output that does
        // not exist under the SvelteKit dev server, which makes /sw.js fail
        // with a 500 overlay in development.
        enabled: false
      }
    })
  ],
  ssr: {
    noExternal: ['@lucide/svelte']
  }
});
