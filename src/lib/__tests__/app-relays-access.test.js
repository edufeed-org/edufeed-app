/** @vitest-environment node */
// Convention: app relays are read through relay-helper.js /
// app-relay-service.svelte.js, never from `runtimeConfig.appRelays`. The raw
// config is the server default only: reading it skips the user's kind 30002
// overrides, and pairing it with `runtimeConfig.fallbackRelays` also ignores
// gated mode. See CLAUDE.md "User Relay Overrides".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'src/lib/helpers/relay-helper.js',
  'src/lib/services/app-relay-service.svelte.js',
  'src/lib/stores/config.svelte.js'
]);

const files = execSync("git ls-files 'src/**/*.js' 'src/**/*.svelte'", { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.includes('__tests__') && !f.includes('__mocks__') && !ALLOWED.has(f));

describe('app relay access', () => {
  it('no module reads runtimeConfig.appRelays directly', () => {
    const offenders = files.filter((f) =>
      /runtimeConfig\??\.appRelays/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
