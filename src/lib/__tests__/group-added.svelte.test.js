// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
// The hook must hand the user's joined communities (kind 30000 `communities`)
// to the rules: without them a second, false claim on a group sends the inbox
// row back to the relay view.
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { nip19 } from 'nostr-tools';

const ME = 'e'.repeat(64);
const OWNER = 'a'.repeat(64);
const STRANGER = 'c'.repeat(64);
const RELAY = 'wss://groups.example';

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const eventStore = new EventStore();
  eventStore.verifyEvent = undefined;
  return { eventStore };
});
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => ({ pubkey: ME }) }));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getGroupsRelays: () => [RELAY] }));

const ev = (n, kind, pubkey, tags) => ({
  id: String(n).repeat(64),
  sig: '0'.repeat(128),
  kind,
  pubkey,
  tags,
  content: '',
  created_at: 1000 + n
});

describe('useGroupAddedTarget', () => {
  it('opens the community I joined when a stranger claims the same group', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    const { useGroupAddedTarget } = await import('$lib/groups/group-added.svelte.js');
    eventStore.add(ev(1, 10222, STRANGER, [['membership', 'root1', RELAY]]));
    eventStore.add(ev(2, 10222, OWNER, [['membership', 'root1', RELAY]]));
    eventStore.add(
      ev(3, 30000, ME, [
        ['d', 'communities'],
        ['p', OWNER]
      ])
    );

    let target;
    const stop = $effect.root(() => {
      target = useGroupAddedTarget(() => ({ kind: 9000, tags: [['h', 'root1']] }));
    });
    flushSync();
    expect(target().href).toBe(`/c/${nip19.npubEncode(OWNER)}`);
    stop();
  });
});
