/** @vitest-environment node */
// Which accounts a logout would lose for good: local-key (nsec) accounts
// whose backup file was never downloaded (issue ddce9cc0, part E).
import { describe, it, expect } from 'vitest';
import { accountNeedsBackup, unsavedAccounts } from '$lib/helpers/account-backup.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const downloaded = (/** @type {string} */ pk) => pk === B;

describe('accountNeedsBackup', () => {
  it('is true only for nsec accounts without the downloaded flag', () => {
    expect(accountNeedsBackup({ type: 'nsec', pubkey: A }, downloaded)).toBe(true);
    expect(accountNeedsBackup({ type: 'nsec', pubkey: B }, downloaded)).toBe(false);
    expect(accountNeedsBackup({ type: 'extension', pubkey: A }, downloaded)).toBe(false);
    expect(accountNeedsBackup({ type: 'nostr-connect', pubkey: A }, downloaded)).toBe(false);
    expect(accountNeedsBackup({ type: 'readonly', pubkey: A }, downloaded)).toBe(false);
    expect(accountNeedsBackup(null, downloaded)).toBe(false);
  });
});

describe('unsavedAccounts', () => {
  it('keeps the order and drops everything that is safe', () => {
    const accounts = [
      { id: '1', type: 'nsec', pubkey: A },
      { id: '2', type: 'nsec', pubkey: B },
      { id: '3', type: 'extension', pubkey: A }
    ];
    expect(unsavedAccounts(accounts, downloaded).map((a) => a.id)).toEqual(['1']);
    expect(unsavedAccounts([], downloaded)).toEqual([]);
  });
});
