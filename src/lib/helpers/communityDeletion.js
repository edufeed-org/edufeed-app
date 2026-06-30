/**
 * Community deletion helpers (NIP-09).
 *
 * A "community" is a Nostr keypair (Communikey). Deleting a community means
 * publishing NIP-09 (kind 5) deletion requests signed by the community's own
 * signer that target the community's events. Relays only honour a deletion if
 * it is signed by the same pubkey that authored the targeted events, so every
 * function here assumes a signer for `pubkey` is available to the caller.
 *
 * Two scopes:
 *   - 'community': the community identity + access-control events only
 *     (definition, profile metadata, ACL profile lists, legacy badges/targeted
 *     publications). The keypair survives and can be reused.
 *   - 'all': every event the community keypair ever authored. For a
 *     current-keypair community this is the user's entire Nostr history.
 *
 * Pure selection/backup logic lives here so it can be unit-tested without the
 * network. The network collector and the publisher are thin wrappers.
 */
import { getSeenRelays } from 'applesauce-core/helpers';
import { lastValueFrom, toArray } from 'rxjs';
import { timedPool } from '$lib/loaders/base.js';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

/**
 * Kinds that make up a community's identity + access control. Used by the
 * 'community' deletion scope. Ordered low→high for stable test assertions.
 * - 0      kind 0 profile metadata (name, avatar, banner)
 * - 10222  Communikey community definition
 * - 30000  NIP-51 profile lists used as ACL gates
 * - 30009  legacy access-control badge definitions (old spec)
 * - 30222  legacy targeted publications (old spec)
 * @type {number[]}
 */
export const COMMUNITY_EVENT_KINDS = [0, 10222, 30000, 30009, 30222];

/**
 * Select which of the given events should be deleted for a community.
 * Pure: no network, no mutation of inputs.
 *
 * Guarantees:
 *  - only events authored by `pubkey` are ever returned (safety net),
 *  - kind 5 deletion events are never selected (don't delete deletions),
 *  - results are deduplicated by event id.
 *
 * @param {any[]} events - Candidate events.
 * @param {string} pubkey - The community pubkey.
 * @param {'community' | 'all'} scope
 * @returns {any[]}
 */
export function selectEventsForDeletion(events, pubkey, scope) {
  const seen = new Set();
  const out = [];
  for (const event of events || []) {
    if (!event || event.pubkey !== pubkey) continue;
    if (event.kind === 5) continue;
    if (scope === 'community' && !COMMUNITY_EVENT_KINDS.includes(event.kind)) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

/**
 * Build a downloadable JSON backup of the given events. Pure — no DOM/IO.
 *
 * @param {any[]} events
 * @param {object} opts
 * @param {string} opts.pubkey - The community pubkey.
 * @returns {{ content: string, filename: string }}
 */
export function buildCommunityBackup(events, { pubkey }) {
  const exportedAt = new Date().toISOString();
  const content = JSON.stringify(
    {
      pubkey,
      exportedAt,
      count: events.length,
      events
    },
    null,
    2
  );
  const datePart = exportedAt.slice(0, 10);
  const filename = `community-backup-${pubkey.slice(0, 12)}-${datePart}.json`;
  return { content, filename };
}

/**
 * Trigger a browser download of a community backup file. Browser-only.
 * @param {any[]} events
 * @param {{ pubkey: string }} opts
 */
export function downloadCommunityBackup(events, opts) {
  const { content, filename } = buildCommunityBackup(events, opts);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Collect the community's events from the network and return the subset that
 * the given scope would delete.
 *
 * @param {object} opts
 * @param {string} opts.pubkey - The community pubkey.
 * @param {'community' | 'all'} opts.scope
 * @param {string[]} opts.relays - Relays to query.
 * @returns {Promise<any[]>}
 */
export async function collectCommunityEvents({ pubkey, scope, relays }) {
  /** @type {import('nostr-tools').Filter} */
  const filter =
    scope === 'community'
      ? { authors: [pubkey], kinds: COMMUNITY_EVENT_KINDS }
      : { authors: [pubkey] };

  const events = await lastValueFrom(timedPool(relays, [filter]).pipe(toArray()));
  // timedPool may emit strings/EOSE markers depending on pool config — keep only
  // event-shaped values authored by the community.
  const eventObjects = (events || []).filter(
    (/** @type {any} */ e) => e && typeof e === 'object' && typeof e.kind === 'number'
  );
  return selectEventsForDeletion(eventObjects, pubkey, scope);
}

/**
 * Publish NIP-09 deletion requests for the given events, signed by the
 * community's signer. Adds the deletion(s) to the EventStore optimistically and
 * publishes them to the communikey relays plus every relay each event was seen
 * on (so the originals actually get removed).
 *
 * Events are chunked so a single deletion request never carries an unbounded
 * number of tags.
 *
 * @param {object} opts
 * @param {any[]} opts.events - Events to delete (already filtered/selected).
 * @param {{ signEvent: (t: any) => Promise<any> }} opts.signer - The community signer.
 * @param {number} [opts.batchSize] - Max events per deletion request (default 100).
 * @returns {Promise<{ success: boolean, deleted: number, error?: string }>}
 */
export async function deleteCommunityEvents({ events, signer, batchSize = 100 }) {
  if (!signer) return { success: false, deleted: 0, error: 'Missing community signer' };
  if (!events || events.length === 0) return { success: true, deleted: 0 };

  try {
    const factory = createAppEventFactory({ signer });
    const communikeyRelays = getCommunikeyRelays();

    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      const deleteTemplate = await factory.delete(batch);
      const signedDelete = await factory.sign(deleteTemplate);

      // Optimistic: filter the originals out of the UI immediately.
      eventStore.add(signedDelete);

      // Reach every relay that still holds an original event in this batch.
      const seen = new Set(communikeyRelays);
      for (const e of batch) {
        const provenance = getSeenRelays(e);
        if (provenance) for (const r of provenance) seen.add(r);
      }

      publishEventOptimistic(signedDelete, [], { additionalRelays: Array.from(seen) });
    }

    return { success: true, deleted: events.length };
  } catch (error) {
    console.error('Failed to delete community events:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, deleted: 0, error: message };
  }
}
