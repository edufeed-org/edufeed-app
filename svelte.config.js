import adapter from '@sveltejs/adapter-node';
import { readFileSync } from 'node:fs';
import { resolveAppVersion } from './scripts/app-version.mjs';

const { version: pkgVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
);

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Update detection: the client polls /_app/version.json every 5 minutes
    // and `updated.current` ($app/state) flips once a build with another
    // `name` is deployed — the root layout then offers a reload. The name is
    // `<package version>+<short sha>` (see scripts/app-version.mjs), the same
    // string vite.config.js exposes as __APP_VERSION__.
    version: {
      name: resolveAppVersion({ pkgVersion }),
      pollInterval: 300_000
    },
    adapter: adapter({
      out: 'build',
      precompress: false,
      envPrefix: ''
    }),
    alias: {
      $paraglide: './src/lib/paraglide'
    }
  }
};

export default config;
