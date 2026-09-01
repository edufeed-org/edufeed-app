/**
 * parseRelayListEvent feeds three keyed {#each} blocks that key on `entry.url`:
 * the settings relay editor (routes/settings/+page.svelte), the list detail
 * view (NIP51ListDetailView) and the dashboard list card (DashboardLists).
 * Kind 10002 is untrusted network input, so a repeated r-tag would hand Svelte
 * a duplicate key and kill the whole page with each_key_duplicate.
 *
 * Deduping has to MERGE rather than drop: NIP-65 lets a client express
 * read+write as two separate marked tags, and the settings editor writes its
 * parsed list straight back out — dropping the second tag would silently strip
 * a marker from the user's published relay list.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  invalidateRelayListCache: vi.fn(),
  getRelayListLookupRelays: () => []
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: { active: null } }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
  pool: {}
}));

import { parseRelayListEvent } from '$lib/services/relay-settings-service.js';

/** @param {string[][]} tags */
const ev = (tags) => /** @type {any} */ ({ kind: 10002, tags });

describe('parseRelayListEvent', () => {
  it('parses unmarked, read and write tags', () => {
    expect(
      parseRelayListEvent(
        ev([
          ['r', 'wss://both.example'],
          ['r', 'wss://read.example', 'read'],
          ['r', 'wss://write.example', 'write']
        ])
      )
    ).toEqual([
      { url: 'wss://both.example', read: true, write: true },
      { url: 'wss://read.example', read: true, write: false },
      { url: 'wss://write.example', read: false, write: true }
    ]);
  });

  it('ignores non-r tags and empty events', () => {
    expect(parseRelayListEvent(ev([['p', 'a'.repeat(64)]]))).toEqual([]);
    expect(parseRelayListEvent(null)).toEqual([]);
    expect(parseRelayListEvent(undefined)).toEqual([]);
    expect(parseRelayListEvent(/** @type {any} */ ({ kind: 10002 }))).toEqual([]);
  });

  it('emits one entry per URL when a relay is repeated', () => {
    const entries = parseRelayListEvent(
      ev([
        ['r', 'wss://dup.example'],
        ['r', 'wss://dup.example']
      ])
    );

    expect(entries).toHaveLength(1);
    expect(new Set(entries.map((e) => e.url)).size).toBe(entries.length);
  });

  it('merges a read tag and a write tag for the same relay into one read+write entry', () => {
    // Legitimate NIP-65: two marked tags express what one unmarked tag would.
    // Keeping only the first would strip the write marker on the next save.
    expect(
      parseRelayListEvent(
        ev([
          ['r', 'wss://split.example', 'read'],
          ['r', 'wss://split.example', 'write']
        ])
      )
    ).toEqual([{ url: 'wss://split.example', read: true, write: true }]);
  });

  it('keeps the first-seen order when merging', () => {
    expect(
      parseRelayListEvent(
        ev([
          ['r', 'wss://a.example'],
          ['r', 'wss://b.example', 'read'],
          ['r', 'wss://a.example', 'write'],
          ['r', 'wss://b.example', 'write']
        ])
      ).map((e) => e.url)
    ).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('drops r-tags with no URL instead of emitting undefined keys', () => {
    // Two bare ["r"] tags would both key as `undefined` — the same crash.
    expect(
      parseRelayListEvent(
        ev([['r'], ['r'], ['r', ''], ['r', /** @type {any} */ (null)], ['r', 'wss://ok.example']])
      )
    ).toEqual([{ url: 'wss://ok.example', read: true, write: true }]);
  });

  it('never returns duplicate keys for a hostile event', () => {
    const entries = parseRelayListEvent(
      ev([
        ['r', 'wss://x.example'],
        ['r', 'wss://x.example', 'read'],
        ['r', 'wss://x.example', 'write'],
        ['r'],
        ['r']
      ])
    );

    expect(new Set(entries.map((e) => e.url)).size).toBe(entries.length);
  });
});
