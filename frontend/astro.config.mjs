import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import AstroPWA from '@vite-pwa/astro';

export default defineConfig({
  integrations: [
    tailwind({ applyBaseStyles: false }),
    AstroPWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
      ],
      manifest: {
        name: 'MoesConverter · MP4 a MP3',
        short_name: 'MoesConverter',
        description:
          'Convierte MP4 a MP3 y transcribe audio a texto. Rápido, privado, gratuito.',
        theme_color: '#07070b',
        background_color: '#07070b',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'es',
        categories: ['utilities', 'productivity', 'multimedia'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Transformers.js model files are large; don't precache them
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/huggingface\.co\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'hf-models',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 4321, host: true },
  vite: {
    server: { hmr: { overlay: true } },
    // Transformers.js requires these headers for SharedArrayBuffer (WebGPU)
    // Dev only; production sets via vercel.json
    optimizeDeps: {
      exclude: ['@huggingface/transformers'],
    },
  },
});
