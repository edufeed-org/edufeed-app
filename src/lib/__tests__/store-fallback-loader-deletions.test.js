/** @vitest-environment node */
// The EventStore's fallback loader feeds ReplaceableModel / EventModel
// directly. A relay that ignored a NIP-09 deletion still answers with the
// deleted copy, and EventStore.add returns deleted events instead of null, so
// without a filter every `eventStore.replaceable(...)` reader saw the deleted
// profile or relay list as present (issue 22bf9b1e: no setup hint, and
// "Profile already exists" on save).
import { describe, it, expect, vi } from 'vitest';
import { of, lastValueFrom, toArray } from 'rxjs';

const dead = { id: 'dead', kind: 0, pubkey: 'p'.repeat(64), created_at: 1, tags: [], content: '' };
const live = { id: 'live', kind: 0, pubkey: 'p'.repeat(64), created_at: 2, tags: [], content: '' };

vi.mock('applesauce-loaders/loaders', () => ({
  createAddressLoader: () => () => of(dead, live),
  createEventLoader: () => () => of(dead, live),
  createTagValueLoader: () => () => of()
}));
/** @type {{ eventLoader: any, deleteManager: { check: (e: any) => boolean } }} */
const eventStore = { eventLoader: null, deleteManager: { check: (e) => e.id === 'dead' } };
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: {}, eventStore }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => [],
  getEventLoaderLookupRelays: () => []
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({ cacheRequest: vi.fn(async () => []) }));

describe('EventStore fallback loader', () => {
  it('never hands a deleted event to the models (address and id lookups)', async () => {
    await import('$lib/loaders/base.js');
    const byAddress = await lastValueFrom(
      eventStore.eventLoader({ kind: 0, pubkey: 'p'.repeat(64) }).pipe(toArray())
    );
    const byId = await lastValueFrom(eventStore.eventLoader({ id: 'x' }).pipe(toArray()));
    expect(byAddress.map((/** @type {any} */ e) => e.id)).toEqual(['live']);
    expect(byId.map((/** @type {any} */ e) => e.id)).toEqual(['live']);
  });
});
