/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

// Mock applesauce-core/helpers
vi.mock('applesauce-core/helpers', () => ({
  getSeenRelays: vi.fn()
}));

// Mock applesauce-common/helpers (needed by urlGrouping.js + contentNavigation.js)
vi.mock('applesauce-common/helpers', () => ({
  getHighlightSourceUrl: vi.fn(),
  // Minimal NIP-22 root-pointer mock derived from uppercase tags (K/I/E/A).
  // Real applesauce caches via Symbol; we don't need that here.
  getCommentRootPointer: vi.fn((/** @type {any} */ event) => {
    const K = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'K')?.[1];
    const I = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'I')?.[1];
    const E = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'E')?.[1];
    const A = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'A')?.[1];
    if (!K) return null;
    if (I) return { type: 'external', kind: K, identifier: I };
    if (A) return { type: 'address', kind: parseInt(K) };
    if (E) return { type: 'event', kind: parseInt(K) };
    return null;
  }),
  isCommentExternalPointer: vi.fn((/** @type {any} */ p) => !!p && p.type === 'external')
}));

// Mock nostrUtils — our module's direct dependency — to avoid its transitive imports
// (relay-helper → app-settings → window)
vi.mock('$lib/helpers/nostrUtils.js', async () => {
  const { nip19 } = await import('nostr-tools');

  return {
    encodeEventToNaddr: vi.fn((/** @type {any} */ event) => {
      try {
        const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
        return nip19.naddrEncode({
          identifier: dTag,
          pubkey: event.pubkey,
          kind: event.kind
        });
      } catch {
        return '';
      }
    }),
    hexToNpub: vi.fn((/** @type {string} */ hex) => {
      if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return null;
      try {
        return nip19.npubEncode(hex);
      } catch {
        return null;
      }
    })
  };
});

import { getContentEventRoute, resolveCommunityPubkey } from '$lib/helpers/contentNavigation.js';
import { getSeenRelays } from 'applesauce-core/helpers';
import { getHighlightSourceUrl } from 'applesauce-common/helpers';

/**
 * Helper to create a minimal event
 * @param {Partial<import('nostr-tools').NostrEvent> & { kind: number }} overrides
 */
function makeEvent(overrides) {
  return {
    id: 'abc123'.padEnd(64, '0'),
    pubkey: 'def456'.padEnd(64, '0'),
    created_at: 1700000000,
    content: '',
    sig: '0'.repeat(128),
    tags: [],
    ...overrides
  };
}

describe('getContentEventRoute', () => {
  describe('calendar events (kind 31922/31923)', () => {
    it('returns /calendar/event/{naddr} for kind 31922', () => {
      const event = makeEvent({
        kind: 31922,
        tags: [['d', 'my-date-event']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/calendar\/event\/naddr1/);
    });

    it('returns /calendar/event/{naddr} for kind 31923', () => {
      const event = makeEvent({
        kind: 31923,
        tags: [['d', 'my-time-event']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/calendar\/event\/naddr1/);
    });

    it('returns /c/{npub}/event/{naddr} when communityPubkey is provided', () => {
      const communityPubkey = 'aa'.repeat(32);
      const event = makeEvent({
        kind: 31923,
        tags: [['d', 'my-time-event']]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/c\/npub1[a-z0-9]+\/event\/naddr1/);
    });
  });

  describe('educational content (kind 30142)', () => {
    it('returns /{naddr} (detail page via naddr catch-all route)', () => {
      const event = makeEvent({
        kind: 30142,
        tags: [['d', 'my-resource']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/naddr1/);
    });

    it('returns /c/{npub}/r/{naddr} when communityPubkey is provided', () => {
      const communityPubkey = 'aa'.repeat(32);
      const event = makeEvent({
        kind: 30142,
        tags: [['d', 'my-resource']]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/c\/npub1[a-z0-9]+\/r\/naddr1/);
    });
  });

  describe('kanban board (kind 30301)', () => {
    it('returns /{naddr} without community', () => {
      const event = makeEvent({
        kind: 30301,
        tags: [['d', 'my-board']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/naddr1/);
    });

    it('returns /c/{npub}/board/{naddr} when communityPubkey is provided', () => {
      const communityPubkey = 'aa'.repeat(32);
      const event = makeEvent({
        kind: 30301,
        tags: [['d', 'my-board']]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/c\/npub1[a-z0-9]+\/board\/naddr1/);
    });
  });

  describe('forms (kind 30168)', () => {
    it('returns /forms/{naddr}', () => {
      const event = makeEvent({
        kind: 30168,
        tags: [['d', 'my-form']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/forms\/naddr1/);
    });
  });

  describe('addressable content kinds (30023, 30818)', () => {
    it.each([30023, 30818])('returns /{naddr} for kind %i', (kind) => {
      const event = makeEvent({
        kind,
        tags: [['d', 'my-content']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/naddr1/);
    });
  });

  describe('other addressable kinds (fallback)', () => {
    it('returns /{naddr} for unknown addressable kind', () => {
      const event = makeEvent({
        kind: 30999,
        tags: [['d', 'unknown-thing']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/naddr1/);
    });
  });

  describe('kind 11 (forum discussion)', () => {
    it('returns /{nevent} with relay hints from seen relays', () => {
      const relays = new Set(['wss://relay1.example.com', 'wss://relay2.example.com']);
      /** @type {any} */ (getSeenRelays).mockReturnValue(relays);

      const event = makeEvent({ kind: 11 });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/nevent1/);
    });

    it('returns /{nevent} without relays when no seen relays', () => {
      /** @type {any} */ (getSeenRelays).mockReturnValue(undefined);

      const event = makeEvent({ kind: 11 });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/nevent1/);
    });
  });

  describe('bookmark (kind 39701)', () => {
    it('returns /c/{npub}/bookmarks/{url} with community', () => {
      const communityPubkey = 'aa'.repeat(32);
      const event = makeEvent({
        kind: 39701,
        tags: [['d', 'example.com/page']]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/c\/npub1/);
      expect(route).toContain('/bookmarks/');
      expect(route).toContain(encodeURIComponent('https://example.com/page'));
    });

    it('returns /{naddr} without community', () => {
      const event = makeEvent({
        kind: 39701,
        tags: [['d', 'example.com/page']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/naddr1/);
    });
  });

  describe('highlight (kind 9802)', () => {
    it('returns /c/{npub}/bookmarks/{url}#highlight-{id} for URL highlight with community', () => {
      const communityPubkey = 'aa'.repeat(32);
      const event = makeEvent({
        kind: 9802,
        tags: [['r', 'https://example.com/article']]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/c\/npub1/);
      expect(route).toContain('/bookmarks/');
      expect(route).toContain(`#highlight-${event.id}`);
    });

    it('returns /c/{npub}/{routePrefix}/{naddr}#highlight-{id} for event-ref highlight with community', () => {
      const communityPubkey = 'aa'.repeat(32);
      const targetPubkey = 'bb'.repeat(32);
      const event = makeEvent({
        kind: 9802,
        tags: [['a', `30818:${targetPubkey}:my-wiki-page`]]
      });
      /** @type {any} */ (getHighlightSourceUrl).mockReturnValue(undefined);

      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/c\/npub1/);
      expect(route).toContain('/wiki/');
      expect(route).toContain('naddr1');
      expect(route).toContain(`#highlight-${event.id}`);
    });

    it('returns /c/{npub}/article/{naddr}#highlight-{id} for 30023 event-ref highlight', () => {
      const communityPubkey = 'aa'.repeat(32);
      const targetPubkey = 'bb'.repeat(32);
      const event = makeEvent({
        kind: 9802,
        tags: [['a', `30023:${targetPubkey}:my-article`]]
      });
      /** @type {any} */ (getHighlightSourceUrl).mockReturnValue(undefined);

      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toContain('/article/');
      expect(route).toContain(`#highlight-${event.id}`);
    });

    it('falls back to /nevent without community', () => {
      // Without community context the bookmark route can't be built; rather
      // than producing a silent no-op click, fall through to the generic
      // nevent route. The detail page will show an "unsupported kind" message
      // for kind 9802, but that's honest UX vs. dead clicks.
      /** @type {any} */ (getSeenRelays).mockReturnValue(undefined);
      const event = makeEvent({
        kind: 9802,
        tags: [['r', 'https://example.com/article']]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/nevent1/);
    });
  });

  describe('page note (kind 1111)', () => {
    it('returns /c/{npub}/bookmarks/{url} for web page note with community', () => {
      const communityPubkey = 'aa'.repeat(32);
      const event = makeEvent({
        kind: 1111,
        tags: [
          ['K', 'web'],
          ['I', 'https://example.com/page']
        ]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/c\/npub1/);
      expect(route).toContain('/bookmarks/');
    });

    it('falls back to /nevent for K=web page-note without community', () => {
      // Without community context we can't build the /c/{npub}/bookmarks/{url}
      // route, so the click should still go somewhere — fall through to the
      // generic nevent detail route, which renders kind 1111 via ThreadDetailView.
      /** @type {any} */ (getSeenRelays).mockReturnValue(undefined);
      const event = makeEvent({
        kind: 1111,
        tags: [
          ['K', 'web'],
          ['I', 'https://example.com/page']
        ]
      });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/nevent1/);
    });

    it('returns /nevent for kind 1111 reply (event-rooted, not a page note)', () => {
      const communityPubkey = 'aa'.repeat(32);
      const targetPubkey = 'bb'.repeat(32);
      /** @type {any} */ (getSeenRelays).mockReturnValue(undefined);
      const event = makeEvent({
        kind: 1111,
        tags: [
          ['K', '30142'],
          ['A', `30142:${targetPubkey}:some-resource`]
        ]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/nevent1/);
    });

    it('returns /nevent for kind 1111 community-targeted reply (h-tag)', () => {
      // The actual user-reported case: a NIP-22 reply with an h-tag landing in the
      // community feed. The detail page handles the h-tag → /c/{npub}/{nevent} redirect.
      const communityPubkey = 'aa'.repeat(32);
      const targetPubkey = 'bb'.repeat(32);
      /** @type {any} */ (getSeenRelays).mockReturnValue(undefined);
      const event = makeEvent({
        kind: 1111,
        tags: [
          ['h', communityPubkey],
          ['K', '30142'],
          ['A', `30142:${targetPubkey}:some-resource`]
        ]
      });
      const route = getContentEventRoute(event, { communityPubkey });
      expect(route).toMatch(/^\/nevent1/);
    });
  });

  describe('nevent fallback for non-addressable kinds', () => {
    it('returns /{nevent} for kind 1 (text note)', () => {
      /** @type {any} */ (getSeenRelays).mockReturnValue(new Set(['wss://relay.example.com']));
      const event = makeEvent({ kind: 1 });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/nevent1/);
    });

    it('returns /{nevent} for kind 7 (reaction)', () => {
      /** @type {any} */ (getSeenRelays).mockReturnValue(undefined);
      const event = makeEvent({ kind: 7 });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/nevent1/);
    });

    it('returns /{nevent} for kind 9 (chat message)', () => {
      /** @type {any} */ (getSeenRelays).mockReturnValue(undefined);
      const event = makeEvent({ kind: 9 });
      const route = getContentEventRoute(event);
      expect(route).toMatch(/^\/nevent1/);
    });
  });
});

describe('resolveCommunityPubkey', () => {
  const communityA = 'aa'.repeat(32);
  const communityB = 'bb'.repeat(32);

  it('returns h-tag value when present on the event', () => {
    const event = makeEvent({
      kind: 9802,
      tags: [
        ['h', communityA],
        ['r', 'https://example.com']
      ]
    });
    const result = resolveCommunityPubkey(event);
    expect(result).toBe(communityA);
  });

  it('prefers h-tag over perCommunityItems lookup', () => {
    const event = makeEvent({
      kind: 9802,
      tags: [
        ['h', communityA],
        ['r', 'https://example.com']
      ]
    });
    const map = new Map([[communityB, [event]]]);
    expect(resolveCommunityPubkey(event, map)).toBe(communityA);
  });

  it('falls back to perCommunityItems when event has no h-tag (reposted/shared events)', () => {
    const event = makeEvent({
      kind: 9802,
      id: 'cc'.repeat(32),
      tags: [['r', 'https://example.com']]
    });
    const map = new Map([
      [communityA, [makeEvent({ kind: 30142, id: '11'.repeat(32) })]],
      [communityB, [event, makeEvent({ kind: 30142, id: '22'.repeat(32) })]]
    ]);
    expect(resolveCommunityPubkey(event, map)).toBe(communityB);
  });

  it('returns undefined when event has no h-tag and no perCommunityItems', () => {
    const event = makeEvent({
      kind: 9802,
      tags: [['r', 'https://example.com']]
    });
    expect(resolveCommunityPubkey(event)).toBeUndefined();
  });

  it('returns undefined when event has no h-tag and is not in any community', () => {
    const event = makeEvent({
      kind: 9802,
      id: 'ff'.repeat(32),
      tags: [['r', 'https://example.com']]
    });
    const map = new Map([[communityA, [makeEvent({ kind: 30142, id: '11'.repeat(32) })]]]);
    expect(resolveCommunityPubkey(event, map)).toBeUndefined();
  });
});
