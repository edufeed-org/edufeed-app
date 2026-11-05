// @ts-nocheck
/**
 * Deleting a calendar event must also delete its cross-kind twin
 * (edufeed-app issue: "Calendar delete: deleting one of two cross-kind twins
 * leaves the other alive").
 *
 * NIP-52 splits one appointment across kind 31922 (all-day) and 31923
 * (timed), replaceable per kind:pubkey:d. A publisher that flips the kind
 * under a stable d-tag (an importer rewriting its events, or a future edit
 * path) leaves two live coordinates. `dedupeCalendarTwins`
 * (calendar-timing.js) hides the older one so only one shows in any list —
 * but hiding is not deleting. Before this fix, `deleteCalendarEvent` built a
 * NIP-09 delete that only addressed the kind of the event the user clicked
 * on, so the hidden twin was untouched and resurfaced once the visible one
 * was gone.
 *
 * This test uses the real applesauce EventStore (not a mock) so the twin
 * lookup (`eventStore.getReplaceable`) and the NIP-09 propagation (both
 * coordinates actually disappearing from the store) are exercised for real.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn(async () => ({ success: true }))
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({ cacheDeletion: vi.fn() }));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  kindToAppRelayCategory: (/** @type {number} */ kind) =>
    [31922, 31923].includes(kind) ? 'calendar' : null,
  getAppRelaysForCategory: () => ['wss://calendar.example']
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: {} }));

import { deleteCalendarEvent } from '$lib/helpers/eventDeletion.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const activeUser = {
  pubkey,
  signer: { signEvent: (/** @type {any} */ draft) => finalizeEvent(draft, sk) }
};

/** @param {number} kind @param {number} createdAt @param {string} dTag @param {string} title */
function makeCalendarEvent(kind, createdAt, dTag, title) {
  return finalizeEvent(
    {
      kind,
      created_at: createdAt,
      tags: [
        ['d', dTag],
        ['title', title],
        ['start', kind === 31922 ? '2026-01-01' : '1767225600']
      ],
      content: ''
    },
    sk
  );
}

describe('deleteCalendarEvent — cross-kind twins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventStore.removeByFilters({ authors: [pubkey] });
  });

  it('deletes both coordinates in one NIP-09 event when a twin is known', async () => {
    const timed = makeCalendarEvent(31923, 2_000_000, 'twin-test-1', 'Timed version');
    const allDay = makeCalendarEvent(31922, 1_000_000, 'twin-test-1', 'All-day version');
    eventStore.add(allDay);
    eventStore.add(timed);

    // The user deletes the visible (newer, timed) twin.
    const result = await deleteCalendarEvent(timed, activeUser);
    expect(result.success).toBe(true);

    // Exactly one kind-5 published — not two.
    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [signedDelete] = vi.mocked(publishEvent).mock.calls[0];
    expect(signedDelete.kind).toBe(5);

    // It must address BOTH coordinates: e-tags for both ids, a-tags for both
    // kind:pubkey:d coordinates, k-tags for both kinds.
    expect(signedDelete.tags).toContainEqual(['e', timed.id]);
    expect(signedDelete.tags).toContainEqual(['e', allDay.id]);
    expect(signedDelete.tags).toContainEqual(['a', `31923:${pubkey}:twin-test-1`]);
    expect(signedDelete.tags).toContainEqual(['a', `31922:${pubkey}:twin-test-1`]);
    expect(signedDelete.tags).toContainEqual(['k', '31923']);
    expect(signedDelete.tags).toContainEqual(['k', '31922']);

    // Neither coordinate remains visible in the store — no twin resurfaces.
    expect(eventStore.getReplaceable(31923, pubkey, 'twin-test-1')).toBeUndefined();
    expect(eventStore.getReplaceable(31922, pubkey, 'twin-test-1')).toBeUndefined();
  });

  it('deletes the single coordinate as before when no twin is known', async () => {
    const timed = makeCalendarEvent(31923, 1_000_000, 'twin-test-2', 'Only version');
    eventStore.add(timed);

    const result = await deleteCalendarEvent(timed, activeUser);
    expect(result.success).toBe(true);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    const [signedDelete] = vi.mocked(publishEvent).mock.calls[0];
    expect(signedDelete.tags).toContainEqual(['a', `31923:${pubkey}:twin-test-2`]);
    expect(signedDelete.tags.filter((/** @type {string[]} */ t) => t[0] === 'a')).toHaveLength(1);

    expect(eventStore.getReplaceable(31923, pubkey, 'twin-test-2')).toBeUndefined();
  });

  it('starting from the all-day twin deletes the timed twin too', async () => {
    const timed = makeCalendarEvent(31923, 2_000_000, 'twin-test-3', 'Timed version');
    const allDay = makeCalendarEvent(31922, 1_000_000, 'twin-test-3', 'All-day version');
    eventStore.add(allDay);
    eventStore.add(timed);

    // Even deleting the OLDER (hidden-by-dedup) twin must still take both.
    const result = await deleteCalendarEvent(allDay, activeUser);
    expect(result.success).toBe(true);

    const [signedDelete] = vi.mocked(publishEvent).mock.calls[0];
    expect(signedDelete.tags).toContainEqual(['a', `31922:${pubkey}:twin-test-3`]);
    expect(signedDelete.tags).toContainEqual(['a', `31923:${pubkey}:twin-test-3`]);

    expect(eventStore.getReplaceable(31922, pubkey, 'twin-test-3')).toBeUndefined();
    expect(eventStore.getReplaceable(31923, pubkey, 'twin-test-3')).toBeUndefined();
  });
});
