/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey } from 'nostr-tools';
import { SimpleAccount } from 'applesauce-accounts/accounts';
import { manager } from '$lib/stores/accounts.svelte.js';

describe('logout removes Termi conversation history', () => {
  beforeEach(() => localStorage.clear());

  it('drops termi.conversations.<pubkey> of the removed account and keeps other keys', () => {
    const a = SimpleAccount.fromKey(generateSecretKey());
    const b = SimpleAccount.fromKey(generateSecretKey());
    manager.addAccount(a);
    manager.addAccount(b);
    localStorage.setItem('termi.conversations.' + a.pubkey, '[]');
    localStorage.setItem('termi.conversations.' + b.pubkey, '[]');
    localStorage.setItem('accounts', 'x');

    manager.removeAccount(a);
    expect(localStorage.getItem('termi.conversations.' + a.pubkey)).toBeNull();
    expect(localStorage.getItem('termi.conversations.' + b.pubkey)).toBe('[]');

    localStorage.setItem('termi.conversations.orphan', '[]');
    manager.removeAccount(b); // last account gone: every termi.conversations.* key goes
    expect(localStorage.getItem('termi.conversations.' + b.pubkey)).toBeNull();
    expect(localStorage.getItem('termi.conversations.orphan')).toBeNull();
    expect(localStorage.getItem('accounts')).toBe('x');
  });
});
