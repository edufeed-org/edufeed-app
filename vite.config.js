import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    allowedHosts: process.env.TUNNEL ? true : undefined,
    proxy: process.env.TUNNEL
      ? {
          '/livekit-ws': {
            target: 'http://localhost:7880',
            ws: true,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/livekit-ws/, '')
          }
        }
      : undefined
  },
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale']
    }),
    tailwindcss(),
    sveltekit(),
    svelteTesting()
  ],
  test: {
    include: ['src/**/*.test.js', 'scripts/**/*.test.mjs'],
    environment: 'jsdom',
    globals: true,
    hookTimeout: 30000
  }
});
