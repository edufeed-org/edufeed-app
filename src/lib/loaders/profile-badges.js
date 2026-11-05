/**
 * Load a user's profile badges list (NIP-58: kind 10008, plus the deprecated
 * kind 30008 `profile_badges`) into the EventStore.
 *
 * Asked from the app's lookup relays AND the owner's NIP-65 write relays: the
 * list is published outbox-model — by this app and by others (Amethyst) — so
 * the lookup relays alone miss it whenever the owner's outbox does not
 * overlap them (2026-11-05: an accepted badge on nostr.mom only, invisible to
 * every visitor). Used by the profile page, the inbox's "accepted" state and
 * AcceptBadgeAward, which must never overwrite a list it simply did not find.
 */
import { EMPTY, catchError, defer, from, merge, mergeMap, of } from 'rxjs';
import { normalizeURL } from 'applesauce-core/helpers';
import {
  PROFILE_BADGES_KIND,
  LEGACY_PROFILE_BADGES_KIND,
  LEGACY_PROFILE_BADGES_IDENTIFIER
} from 'applesauce-common/helpers';
import { addressLoader, eventLoader } from '$lib/loaders/base.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getReadRelays, getWriteRelays } from '$lib/services/relay-service.svelte.js';

/**
 * @param {string} pubkey
 * @param {string[]} relays
 */
function askRelays(pubkey, relays) {
  if (!relays.length) return EMPTY;
  // Kind 10008 is a plain replaceable event with NO d tag — an identifier
  // would poison the batched relay filter with #d for every other replaceable
  // kind loaded in the same second (10015, 10050, 10222, ...).
  return merge(
    addressLoader({ kind: PROFILE_BADGES_KIND, pubkey, relays }),
    addressLoader({
      kind: LEGACY_PROFILE_BADGES_KIND,
      pubkey,
      identifier: LEGACY_PROFILE_BADGES_IDENTIFIER,
      relays
    })
  );
}

/**
 * @param {string} pubkey
 * @returns {import('rxjs').Observable<unknown>} completes when every relay answered
 */
export function loadProfileBadgeLists(pubkey) {
  const lookup = getAllLookupRelays();
  const known = new Set(lookup.map((r) => normalizeURL(r)));
  const outbox = defer(() => getWriteRelays(pubkey)).pipe(
    catchError(() => of(/** @type {string[]} */ ([]))),
    mergeMap((write) =>
      askRelays(
        pubkey,
        write.filter((r) => !known.has(normalizeURL(r)))
      )
    )
  );
  return merge(askRelays(pubkey, lookup), outbox);
}

/**
 * @param {() => Promise<string[]>} get
 * @returns {Promise<string[]>}
 */
const relaysOrNone = (get) => get().catch(() => []);

/**
 * Load one accepted badge's kind 30009 definition and kind 8 award.
 *
 * Lookup relays first (the common case, answers at once), then the outbox
 * model: the definition and the award are the ISSUER's events, on the
 * issuer's write relays, and NIP-58 awards are also delivered to the
 * recipient's read relays. Slots almost never carry relay hints, so without
 * this a badge issued from another client renders as a blank card
 * (2026-11-05: seven of laoc's eight badges).
 *
 * @param {{ badgeAddress: string, awardId: string }} slot
 * @param {string} ownerPubkey the profile the badge is shown on
 * @returns {import('rxjs').Observable<unknown>}
 */
export function loadBadgeSlot(slot, ownerPubkey) {
  const [kindStr, issuer, identifier = ''] = slot.badgeAddress.split(':');
  const kind = Number(kindStr);
  if (kind !== 30009 || !/^[0-9a-f]{64}$/i.test(issuer || '')) return EMPTY;

  /** @param {string[]} relays */
  const ask = (relays) =>
    relays.length
      ? merge(
          addressLoader({ kind, pubkey: issuer, identifier, relays }),
          eventLoader({ id: slot.awardId, relays })
        )
      : EMPTY;

  const lookup = getAllLookupRelays();
  const known = new Set(lookup.map((r) => normalizeURL(r)));
  const outbox = from(
    Promise.all([
      relaysOrNone(() => getWriteRelays(issuer)),
      relaysOrNone(() => getReadRelays(ownerPubkey))
    ])
  ).pipe(
    mergeMap(([issuerOut, ownerIn]) => {
      const extra = [];
      for (const r of [...issuerOut, ...ownerIn]) {
        const key = normalizeURL(r);
        if (known.has(key)) continue;
        known.add(key);
        extra.push(r);
      }
      return ask(extra);
    })
  );
  return merge(ask(lookup), outbox);
}
