import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Cache the dashboard shell for offline *viewing* only — per requirements
      // Section 8, this app never takes live actions (bookings, sends) offline.
      // woff2 added explicitly — the default globPatterns don't include fonts,
      // which would otherwise leave the self-hosted brand typeface (Section 7.1)
      // uncached and silently falling back offline.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      manifest: {
        name: 'MedLocks Command Centre',
        short_name: 'MedLocks',
        description:
          'Management intelligence layer for salon operations and marketing.',
        // Matches the gradient brand refresh (22 Aug 2026) — theme_color is
        // --color-accent-strong (light), background_color is --color-page
        // (light), the two tokens a PWA install/splash screen actually uses.
        theme_color: '#5b1a5e',
        background_color: '#f4eef8',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@/modules': path.resolve(import.meta.dirname, 'src/modules'),
      '@/shared': path.resolve(import.meta.dirname, 'src/shared'),
      '@/lib': path.resolve(import.meta.dirname, 'src/lib'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
});
