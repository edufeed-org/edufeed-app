/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ membership: /** @type {any} */ ({ adminPubkeys: [] }) }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return state.membership;
    }
  }
}));

import { isOfficialPubkey, getOfficialPubkeys } from '$lib/helpers/official-accounts.js';

const ADMIN = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('official accounts', () => {
  beforeEach(() => {
    state.membership = { adminPubkeys: [ADMIN] };
  });

  it('treats the configured membership admins as official', () => {
    expect(isOfficialPubkey(ADMIN)).toBe(true);
    expect(getOfficialPubkeys()).toEqual([ADMIN]);
  });

  it('treats everyone else as ordinary', () => {
    expect(isOfficialPubkey(OTHER)).toBe(false);
    expect(isOfficialPubkey('')).toBe(false);
    expect(isOfficialPubkey(undefined)).toBe(false);
  });

  it('is empty when the membership block is absent', () => {
    state.membership = undefined;
    expect(getOfficialPubkeys()).toEqual([]);
    expect(isOfficialPubkey(ADMIN)).toBe(false);
  });
});
