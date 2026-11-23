// @ts-nocheck
/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect.root is a Svelte rune, available in .svelte.test.js context */
// The relay withholds the member lists of member-gated groups from a
// connection that has not logged in, and the lookup is asked once: so it
// waits for the login when there is a signer.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { Subject } from 'rxjs';

const ME = 'f'.repeat(64);
const h = vi.hoisted(() => ({
  signer: null,
  authenticated: false,
  requests: 0,
  auth: null,
  stream: null
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME, signer: h.signer })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getGroupsRelays: () => ['wss://groups.example']
}));
vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: () => new Promise((resolve) => (h.auth = resolve))
}));
vi.mock('applesauce-relay/operators', () => ({ storeEvents: () => (x) => x }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {},
  pool: {
    relay: () => ({
      get authenticated() {
        return h.authenticated;
      },
      request: () => {
        h.requests++;
        return h.stream;
      }
    })
  }
}));

import { useMyGroupPointers } from '$lib/groups/my-groups.svelte.js';

function mount() {
  let read = () => [];
  const cleanup = $effect.root(() => {
    read = useMyGroupPointers();
  });
  flushSync();
  return { read, cleanup };
}
const roster = (id) => ({
  kind: 39002,
  tags: [
    ['d', id],
    ['p', ME]
  ]
});

beforeEach(() => {
  h.signer = null;
  h.authenticated = false;
  h.requests = 0;
  h.auth = null;
  h.stream = new Subject();
});

describe('useMyGroupPointers', () => {
  it('asks only after the relay login when the account can sign', async () => {
    h.signer = { sign: true };
    const { read, cleanup } = mount();
    expect(h.requests).toBe(0);
    h.auth({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.requests).toBe(1);
    h.stream.next(roster('gated'));
    flushSync();
    expect(read().map((p) => p.id)).toEqual(['gated']);
    cleanup();
  });

  it('marks the groups where my own entry on the 39001 carries a moderation role', () => {
    const { read, cleanup } = mount();
    const admins = (id, ...roles) => ({
      kind: 39001,
      tags: [
        ['d', id],
        ['p', ME, ...roles]
      ]
    });
    h.stream.next(roster('member-only'));
    h.stream.next(admins('mine', 'admin'));
    h.stream.next(roster('later')); // member list first, admin list after
    h.stream.next(admins('later', 'moderator'));
    h.stream.next(admins('publisher', 'publisher'));
    flushSync();
    expect(read().map((p) => [p.id, p.moderator === true])).toEqual([
      ['member-only', false],
      ['mine', true],
      ['later', true],
      ['publisher', false]
    ]);
    cleanup();
  });

  it('asks at once without a signer, or on a connection that is already logged in', () => {
    const a = mount();
    expect(h.requests).toBe(1);
    a.cleanup();
    h.signer = { sign: true };
    h.authenticated = true;
    const b = mount();
    expect(h.requests).toBe(2);
    b.cleanup();
  });

  it('asks nothing when the page is left before the login finished', async () => {
    h.signer = { sign: true };
    const { cleanup } = mount();
    cleanup();
    h.auth({ ok: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.requests).toBe(0);
  });
});
