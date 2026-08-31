// Founding flow: create the Concord community backing a Communikey community
// and publish the updated kind-10222 with the pointer tag. Only imports
// pointer.js/client.svelte.js at the top level (both SSR-safe, no top-level
// package imports) — publish-service.js and nostr-infrastructure.svelte are
// dynamically imported so this module stays importable from the wizard
// component without adding a new static edge into the concord dep tree.
import { withConcordPointer } from './pointer.js';
import { getConcordClient } from './client.svelte.js';

/**
 * Unsigned kind-10222 template with the concord pointer set. Preserves all
 * other tags + content; bumps created_at past the source event.
 * @param {any} communikeyEvent
 * @param {string} communityId
 * @param {string} [relay]
 */
export function buildPointerUpdate(communikeyEvent, communityId, relay) {
  return {
    kind: 10222,
    content: communikeyEvent.content ?? '',
    tags: withConcordPointer(communikeyEvent.tags ?? [], communityId, relay),
    created_at: Math.max(Math.floor(Date.now() / 1000), (communikeyEvent.created_at ?? 0) + 1)
  };
}

// --- Founding idempotency marker -------------------------------------------
// `createNewCommunity` is durable on the relays the moment it resolves; if the
// subsequent pointer sign/publish fails, the hook (which derives `community`
// from the 10222 pointer only) sees nothing — a naive retry would mint a
// SECOND orphaned Concord community. The marker records "community minted,
// pointer not yet published" locally so a retry reuses the minted community
// and re-attempts only the retryable half (the pointer publish). Cleared only
// after the pointer publish succeeds.

const MARKER_PREFIX = 'concord:founding:';

/** localStorage when available (browser); undefined in SSR/node — all helpers no-op then. */
function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} pubkey - Communikey community pubkey
 * @param {{getItem: (k: string) => string|null}} [storage]
 * @returns {string|undefined} pending Concord communityId, if a founding was interrupted
 */
export function readFoundingMarker(pubkey, storage = defaultStorage()) {
  if (!storage || !pubkey) return undefined;
  try {
    return storage.getItem(MARKER_PREFIX + pubkey) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} pubkey - Communikey community pubkey
 * @param {string} communityId - freshly-minted Concord community id
 * @param {{setItem: (k: string, v: string) => void}} [storage]
 */
export function writeFoundingMarker(pubkey, communityId, storage = defaultStorage()) {
  if (!storage || !pubkey || !communityId) return;
  try {
    storage.setItem(MARKER_PREFIX + pubkey, communityId);
  } catch {
    // best-effort: quota/privacy-mode failures must not break founding itself
  }
}

/**
 * @param {string} pubkey - Communikey community pubkey
 * @param {{removeItem: (k: string) => void}} [storage]
 */
export function clearFoundingMarker(pubkey, storage = defaultStorage()) {
  if (!storage || !pubkey) return;
  try {
    storage.removeItem(MARKER_PREFIX + pubkey);
  } catch {
    // ignore
  }
}

/**
 * Found the Concord community backing a Communikey community and publish the
 * pointer. Concord owner = the human owner's PERSONAL key (client signer);
 * the community signer only signs the 10222 update (spec §3.1).
 *
 * Idempotent across partial failure: if a prior call minted the community but
 * died before the pointer published, the persisted founding marker lets the
 * retry reuse that community instead of minting a duplicate (see marker
 * helpers above).
 *
 * The 10222 update goes through the NORMAL publish path (`publishEvent`,
 * outbox model) since it's a Communikey event like any other — only Concord's
 * own 1059 traffic bypasses it. `additionalRelays` mirrors
 * EditCommunityModal's pattern for republishing a community's own 10222: the
 * community's already-configured relays (`getCommunityGlobalRelays`) must be
 * included explicitly, since they may not overlap with the deployment's
 * shared communikey app relays.
 * @param {{communikeyEvent: any, communityName: string, relays: string[], communitySigner: any}} args
 * @returns {Promise<{community: any, communityId: string}>}
 */
export async function foundConcordArea({
  communikeyEvent,
  communityName,
  relays,
  communitySigner
}) {
  const client = getConcordClient();
  if (!client) throw new Error('Concord client not ready');
  if (!communitySigner) throw new Error('No signer available for this community');

  // Resume an interrupted founding: reuse the already-minted community and
  // skip straight to the pointer publish (the retryable part).
  let community;
  const pendingId = readFoundingMarker(communikeyEvent?.pubkey);
  if (pendingId) community = client.getCommunity(pendingId);
  if (!community) {
    community = await client.createNewCommunity(communityName, '', relays);
    writeFoundingMarker(communikeyEvent?.pubkey, community.communityId);
  }
  const communityId = community.communityId;

  const template = buildPointerUpdate(communikeyEvent, communityId, relays[0]);
  const signed = await communitySigner.signEvent(template);
  const [{ publishEvent }, { eventStore }, { getCommunityGlobalRelays }] = await Promise.all([
    import('$lib/services/publish-service.js'),
    import('$lib/stores/nostr-infrastructure.svelte'),
    import('$lib/helpers/communityRelays.js')
  ]);
  await publishEvent(signed, [], { additionalRelays: getCommunityGlobalRelays(signed) });
  eventStore.add(signed);
  clearFoundingMarker(communikeyEvent?.pubkey);
  return { community, communityId };
}
