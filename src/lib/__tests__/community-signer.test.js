/** @vitest-environment node */
// src/lib/__tests__/community-signer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @type {Map<string, any>} */
let accounts;
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    getAccountForPubkey: (/** @type {string} */ pk) => accounts.get(pk) ?? undefined
  }
}));

const { getCommunitySigner, isCommunityOwner } = await import('$lib/helpers/community-signer.js');

const PK = 'a'.repeat(64);
const SIGNER = { signEvent: () => {} };

beforeEach(() => {
  accounts = new Map();
});

describe('getCommunitySigner / isCommunityOwner', () => {
  it('returns the signer when the manager holds the community key', () => {
    accounts.set(PK, { signer: SIGNER });
    expect(getCommunitySigner(PK)).toBe(SIGNER);
    expect(isCommunityOwner(PK)).toBe(true);
  });
  it('null/false when the key is not held, for empty input, and for accounts without signer', () => {
    expect(getCommunitySigner(PK)).toBeNull();
    expect(isCommunityOwner(PK)).toBe(false);
    expect(getCommunitySigner(undefined)).toBeNull();
    accounts.set(PK, {});
    expect(getCommunitySigner(PK)).toBeNull();
  });
});
