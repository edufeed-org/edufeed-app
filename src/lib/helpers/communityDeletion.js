/**
 * Community deletion helpers (NIP-09).
 *
 * A "community" is a Nostr keypair (Communikey). Deleting a community means
 * publishing NIP-09 (kind 5) deletion requests signed by the community's own
 * signer that target the community's events. Relays only honour a deletion if
 * it is signed by the same pubkey that authored the targeted events, so every
 * function here assumes a signer for `pubkey` is available to the caller.
 *
 * Scopes:
 *   - 'community': the community identity + access-control events only
 *     (definition, profile metadata, ACL profile lists, legacy badges/targeted
 *     publications). The keypair survives and can be reused.
 *   - 'personal': 'community' for a community on a person's own key — the
 *     definition, the lists it references and legacy kinds, never the
 *     profile, contacts, relay lists or the person's other lists.
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
import { cacheDeletion } from '$lib/stores/event-cache.svelte.js';
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
 * Kinds a person's key has and a dedicated community key does not (creating a
 * community on a new key publishes only kind 0, 10222 and a membership list).
 * shortcut: a person without follows or relay lists reads as a dedicated key;
 * upgrade to an explicit marker if the dialog ever offers "all" wrongly.
 */
const PERSONAL_MARKER_KINDS = [3, 10002, 10050];

/**
 * @param {any[]} events
 * @param {string} pubkey
 * @returns {boolean}
 */
export function isPersonalKey(events, pubkey) {
  return (events || []).some((e) => e?.pubkey === pubkey && PERSONAL_MARKER_KINDS.includes(e.kind));
}

/**
 * For a community on the user's own key: the community's own events only —
 * never the profile, contacts, relay lists or their other 30000 lists
 * (memberships, follow sets).
 * @param {any} event
 * @param {Set<string>} aclAddresses
 */
function isPersonalCommunityEvent(event, aclAddresses) {
  if (event.kind === 30000) {
    const d = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? '';
    return aclAddresses.has(`30000:${event.pubkey}:${d}`);
  }
  return [10222, 30009, 30222].includes(event.kind);
}

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
 * @param {'community' | 'personal' | 'all'} scope - 'personal' = 'community' for a
 *   community on the logged-in account's own key.
 * @returns {any[]}
 */
export function selectEventsForDeletion(events, pubkey, scope) {
  const seen = new Set();
  const out = [];
  // Profile lists the community definition gates sections with (`a` tags).
  const aclAddresses = new Set(
    (events || [])
      .filter((e) => e?.kind === 10222 && e.pubkey === pubkey)
      .flatMap((e) =>
        e.tags
          .filter((/** @type {string[]} */ t) => t[0] === 'a')
          .map((/** @type {string[]} */ t) => t[1])
      )
  );
  for (const event of events || []) {
    if (!event || event.pubkey !== pubkey) continue;
    if (event.kind === 5) continue;
    if (scope === 'community' && !COMMUNITY_EVENT_KINDS.includes(event.kind)) continue;
    if (scope === 'personal' && !isPersonalCommunityEvent(event, aclAddresses)) continue;
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
 * the given scope would delete. On a person's own key (`personal`), the
 * 'community' scope narrows to 'personal'.
 *
 * @param {object} opts
 * @param {string} opts.pubkey - The community pubkey.
 * @param {'community' | 'all'} opts.scope
 * @param {string[]} opts.relays - Relays to query.
 * @returns {Promise<{ events: any[], personal: boolean }>}
 */
export async function collectCommunityEvents({ pubkey, scope, relays }) {
  /** @type {import('nostr-tools').Filter} */
  const filter =
    scope === 'all'
      ? { authors: [pubkey] }
      : { authors: [pubkey], kinds: [...COMMUNITY_EVENT_KINDS, ...PERSONAL_MARKER_KINDS] };

  const events = await lastValueFrom(timedPool(relays, [filter]).pipe(toArray()));
  // timedPool may emit strings/EOSE markers depending on pool config — keep only
  // event-shaped values authored by the community.
  const eventObjects = (events || []).filter(
    (/** @type {any} */ e) => e && typeof e === 'object' && typeof e.kind === 'number'
  );
  const personal = isPersonalKey(eventObjects, pubkey);
  const effectiveScope = personal && scope === 'community' ? 'personal' : scope;
  return { events: selectEventsForDeletion(eventObjects, pubkey, effectiveScope), personal };
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
 * @param {any} opts.signer - The community signer (EventSigner held by the account manager).
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
      // Persist the deletion so it survives a reload — the EventStore never
      // emits kind 5 on insert$, so the cache write pipeline would miss it and
      // the deleted community would reappear from IDB on the next boot.
      cacheDeletion(signedDelete);

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
