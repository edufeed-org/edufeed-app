/**
 * Wiki Actions Tests
 *
 * NIP-54 wiki pages (kind 30818): NIP-27 references in the body become
 * NIP-10 p tags (bare npubs repaired first) on create and update, and the
 * mentioned users are handed to the outbox.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

/** @type {any} */
let lastSignedEvent = null;

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: null
  }
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: vi.fn(() => 'naddr1test')
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => ['wss://communikey.relay'])
}));

import { manager } from '$lib/stores/accounts.svelte';
import { createWiki, updateWiki } from '../stores/wiki-actions.svelte.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

/** @param {string} pubkey */
function signAs(pubkey) {
  return {
    pubkey,
    signEvent: vi.fn(async (/** @type {any} */ template) => {
      lastSignedEvent = { ...template, id: 'event-id', pubkey, sig: 'sig' };
      return lastSignedEvent;
    })
  };
}

describe('createWiki', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSignedEvent = null;
    /** @type {any} */ (manager).active = signAs('abc123');
  });

  it('p-tags people mentioned in the body (bare npubs repaired) and hands them to the outbox', async () => {
    await createWiki({
      title: 'Topic',
      topic: 'topic',
      content: `See nostr:${nip19.npubEncode(ALICE)} and ${nip19.npubEncode(BOB)}`
    });
    expect(lastSignedEvent.kind).toBe(30818);
    expect(lastSignedEvent.tags).toContainEqual(['p', ALICE]);
    expect(lastSignedEvent.tags).toContainEqual(['p', BOB]);
    expect(lastSignedEvent.content).toContain(`nostr:${nip19.npubEncode(BOB)}`);
    expect(/** @type {any} */ (publishEventOptimistic).mock.calls[0][1]).toEqual([ALICE, BOB]);
  });

  it('adds no p tags without mentions', async () => {
    await createWiki({ title: 'Topic', topic: 'topic', content: 'plain text' });
    expect(lastSignedEvent.tags.some((/** @type {any} */ t) => t[0] === 'p')).toBe(false);
    expect(/** @type {any} */ (publishEventOptimistic).mock.calls[0][1]).toEqual([]);
  });
});

describe('updateWiki', () => {
  const existingEvent = {
    id: 'existing-id',
    kind: 30818,
    pubkey: 'abc123',
    content: 'Old content',
    created_at: 1699000000,
    tags: [
      ['d', 'topic'],
      ['title', 'Old Title']
    ],
    sig: 'sig-old'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastSignedEvent = null;
    /** @type {any} */ (manager).active = signAs('abc123');
  });

  it('p-tags people mentioned in the updated body and hands them to the outbox', async () => {
    await updateWiki(
      { title: 'New Title', topic: 'topic', content: `Hi nostr:${nip19.npubEncode(ALICE)}` },
      existingEvent
    );
    expect(lastSignedEvent.tags).toContainEqual(['p', ALICE]);
    expect(lastSignedEvent.tags).toContainEqual(['d', 'topic']);
    expect(/** @type {any} */ (publishEventOptimistic).mock.calls[0][1]).toEqual([ALICE]);
  });
});
