import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
    include: ['src/**/*.test.js', 'src/**/*.test.svelte.js', 'scripts/**/*.test.mjs'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    hookTimeout: 30000,
    // SvelteKit's vite plugin puts 'browser' ahead of 'node'/'require' in the
    // client resolve.conditions list, and vitest's node-environment tests
    // still go through that same resolver — so a bare `import ... from 'ws'`
    // silently picks the browser stub (throws "does not work in the
    // browser", or here just resolves undefined named exports) instead of
    // the real server-capable module. Aliasing straight to ws's ESM entry
    // file sidesteps package.json "exports" condition matching entirely.
    alias: {
      ws: fileURLToPath(new URL('./node_modules/ws/wrapper.mjs', import.meta.url))
    }
  }
});
