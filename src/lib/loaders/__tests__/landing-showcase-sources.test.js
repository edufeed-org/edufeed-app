/** @vitest-environment node */
// The showcase list must not wait for the slowest relay: one answer per list
// is enough (kind 30000 is replaceable; the next visit refreshes it anyway).
import { describe, it, expect, vi } from 'vitest';
import { Subject } from 'rxjs';

const relay = vi.hoisted(() => ({ subject: /** @type {any} */ (null) }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: () => relay.subject }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => ['wss://x'] }));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  decodeNaddrs: () => [{ pubkey: 'p', identifier: 'd', relays: ['wss://a', 'wss://hangs'] }],
  extractPubkeysFromFollowSets: (/** @type {any[]} */ events) =>
    events.flatMap((e) =>
      e.tags
        .filter((/** @type {string[]} */ t) => t[0] === 'p')
        .map((/** @type {string[]} */ t) => t[1])
    )
}));

const { loadShowcaseSources } = await import('../landing-showcase-sources.js');

describe('loadShowcaseSources', () => {
  it('resolves with the first answer, not when the slowest relay gives up', async () => {
    relay.subject = new Subject();
    const pending = loadShowcaseSources(['naddr1list']);
    relay.subject.next({ kind: 30000, tags: [['p', 'edu']] });
    // the hanging relay never completes the request
    await expect(pending).resolves.toEqual(['edu']);
  });
});
