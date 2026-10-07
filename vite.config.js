import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { mediapipeWasm } from './scripts/vite-plugin-mediapipe-wasm.mjs';

const { version: appVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

export default defineConfig({
  // package.json version, read by $lib/helpers/app-version.js (shown in
  // in-app issue reports so maintainers know which build misbehaved).
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  server: {
    allowedHosts: process.env.TUNNEL ? true : undefined
  },
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale']
    }),
    tailwindcss(),
    mediapipeWasm(),
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
