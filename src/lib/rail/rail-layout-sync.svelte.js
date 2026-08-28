// The rail's arrangement, synced across a user's devices.
//
// Round 3 kept the rail in localStorage on purpose: it names unlinked Concord
// AREAS and privately-held NIP-29 groups, so a plain kind:30078 would announce
// which private rooms the user holds and how they filed them. laoc approved the
// encrypted version on 2026-08-07, which is this module.
//
// Shape borrowed from the app's existing encrypted app-data (inbox read
// markers); CODE deliberately not borrowed. That precedent publishes plaintext
// from a bare catch on any signer hiccup, and collapses "not loaded", "decrypt
// failed" and "empty" into one value. Both are load-bearing failures here, so
// this module keeps the states apart (rail-layout-gate.js) and has no plaintext
// branch to fall into at all.
//
// localStorage stays as the local cache and keeps working signed-out and
// offline; the relay copy is what makes it follow you to a second device.
// `normalizeLayout` is untouched — the whole feature fits behind it.

import { getAppDataEncryption, unlockAppData } from 'applesauce-common/helpers/app-data';
import { unixNow } from 'applesauce-core/helpers/time';
import { finalizeDraft } from '$lib/helpers/event-factory.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
import { hasNip44 } from '$lib/helpers/nip44.js';
import {
  RAIL_LAYOUT_KIND,
  RAIL_LAYOUT_D_TAG,
  encodeRailLayout,
  decodeRailLayout,
  isNewerLayoutEvent,
  nextLayoutCreatedAt
} from './rail-layout-event.js';
import { RAIL_SYNC_STATUS, canPublishRailLayout } from './rail-layout-gate.js';

/** @typedef {import('./rail-layout.js').RailNode} RailNode */
/** @typedef {import('./rail-layout-gate.js').RailSyncStatus} RailSyncStatus */

/** @type {RailSyncStatus} */
let status = $state(RAIL_SYNC_STATUS.idle);
/** @type {RailNode[] | null} */
let remoteLayout = $state(null);
/** @type {{created_at: number, id: string} | null} */
let remoteStamp = null;
/** @type {string | null} */
let activePubkey = null;
/** Set when an edit could not be published; cleared once one lands. */
let blocked = $state(false);
/** @type {Array<{unsubscribe: () => void}>} */
let subscriptions = [];

/**
 * Called whenever a decrypted remote layout arrives, so the local cache can
 * mirror it. Injected rather than imported to keep this module free of a
 * circular dependency on the store.
 * @type {((pubkey: string, layout: RailNode[]) => void) | null}
 */
let mirror = null;

/** @param {(pubkey: string, layout: RailNode[]) => void} fn */
export function setRailLayoutMirror(fn) {
  mirror = fn;
}

export function getRailSyncStatus() {
  return status;
}

/** @returns {RailNode[] | null} null means "not loaded", never "empty". */
export function getRemoteRailLayout() {
  return remoteLayout;
}

/** Whether the last edit failed to reach any relay. */
export function isRailSyncBlocked() {
  return blocked;
}

/**
 * Start following this account's layout event.
 *
 * @param {string | null | undefined} pubkey
 */
export function initializeRailLayoutSync(pubkey) {
  cleanupRailLayoutSync();
  if (!pubkey) return;
  activePubkey = pubkey;

  // No NIP-44, no sync. Not "sync in the clear" — the arrangement is exactly
  // the thing that must not be published readable.
  if (!hasNip44(manager.active?.signer)) {
    status = RAIL_SYNC_STATUS.unavailable;
    return;
  }

  status = RAIL_SYNC_STATUS.loading;

  const relays = getRelayListLookupRelays();
  if (relays.length > 0) {
    const loader = addressLoader({
      kind: RAIL_LAYOUT_KIND,
      pubkey,
      identifier: RAIL_LAYOUT_D_TAG,
      relays
    }).subscribe({
      // The loader completing without an event is the ONLY evidence that
      // nothing is stored. Without it, "no event yet" and "no event at all"
      // are the same observation, and the first save could never happen.
      complete: () => {
        if (activePubkey === pubkey && status === RAIL_SYNC_STATUS.loading) {
          status = RAIL_SYNC_STATUS.absent;
        }
      },
      error: () => {
        /* a failed lookup leaves us in `loading`: unknown, so no publish */
      }
    });
    subscriptions.push(loader);
  } else {
    // NOT `absent`. Nothing was asked, so nothing answered — and `absent`
    // means "the relays answered and hold no layout", which is what makes it
    // safe to publish over. Calling this absent would let the first edit
    // overwrite a layout that exists and was never read: publishEvent builds
    // its own relay set from the outbox model, so a user with no lookup relays
    // can still write perfectly well to relays holding their real arrangement.
    // `unavailable` rather than `loading` because this never resolves on its
    // own — there is nothing outstanding to wait for.
    status = RAIL_SYNC_STATUS.unavailable;
  }

  const sub = eventStore
    .replaceable(RAIL_LAYOUT_KIND, pubkey, RAIL_LAYOUT_D_TAG)
    .subscribe(async (/** @type {any} */ event) => {
      if (!event || activePubkey !== pubkey) return;
      await adoptRemoteEvent(event, pubkey);
    });
  subscriptions.push(sub);
}

/**
 * Take a remote layout event as the current one, if it wins.
 *
 * @param {any} event
 * @param {string} pubkey
 */
async function adoptRemoteEvent(event, pubkey) {
  if (!isNewerLayoutEvent(event, remoteStamp)) return;

  const signer = manager.active?.signer;
  if (!hasNip44(signer)) {
    status = RAIL_SYNC_STATUS.unavailable;
    return;
  }

  /** @type {unknown} */
  let payload;
  try {
    payload = await unlockAppData(event, /** @type {any} */ (signer));
  } catch {
    // Same staleness guard as the success path below: after the await the
    // account may have switched, and the OLD account's unreadable event must
    // not mark the NEW account locked.
    if (activePubkey !== pubkey) return;
    // An event we cannot read is NOT an empty rail. Saying `locked` here is
    // what stops the default order being published over a layout that is
    // probably perfectly good and merely unreadable right now.
    status = RAIL_SYNC_STATUS.locked;
    return;
  }
  if (activePubkey !== pubkey) return;

  const layout = decodeRailLayout(payload);
  if (layout === null) {
    status = RAIL_SYNC_STATUS.locked;
    return;
  }

  remoteStamp = { created_at: event.created_at, id: event.id };
  remoteLayout = layout;
  status = RAIL_SYNC_STATUS.loaded;
  mirror?.(pubkey, layout);
}

/**
 * Publish an arrangement, if it is safe to.
 *
 * Returns why it did not, rather than a bare false, because every reason here
 * has a different meaning to the user: "still loading" resolves on its own,
 * "unavailable" never will, and "rejected" means the relays refused it.
 *
 * @param {string | null | undefined} pubkey
 * @param {RailNode[]} layout
 * @returns {Promise<{published: boolean, reason?: string}>}
 */
export async function publishRailLayout(pubkey, layout) {
  if (!pubkey || pubkey !== activePubkey) return { published: false, reason: 'inactive' };
  if (!canPublishRailLayout(status)) {
    blocked = true;
    return { published: false, reason: status };
  }

  const signer = manager.active?.signer;
  if (!hasNip44(signer)) {
    status = RAIL_SYNC_STATUS.unavailable;
    blocked = true;
    return { published: false, reason: RAIL_SYNC_STATUS.unavailable };
  }

  // A skewed clock must not silently lose every edit, but an unbounded bump
  // mints events a relay drops for being too far ahead — and publishEvent
  // resolves rather than throwing on rejection, so that drop would be silent.
  const createdAt = nextLayoutCreatedAt(unixNow(), remoteStamp?.created_at ?? null);
  if (createdAt === null) {
    blocked = true;
    return { published: false, reason: 'clock-skew' };
  }

  let signed;
  try {
    // Encrypted explicitly rather than through AppDataFactory's `encryption`
    // flag, because that flag CANNOT WORK: `AppDataFactory.data()` calls
    // `setContent(data, encryption)` with two arguments while
    // `setContent(data, encryption, signer)` binds the signer at construction
    // time, so the signer is always undefined and the operation always throws
    // "Signer required for encrypted content" — `.as(signer)` sets a shared
    // ref the operation never reads. The precedent this feature was modelled
    // on wraps that call in a bare catch whose fallback publishes PLAINTEXT,
    // so its encrypted branch has never once succeeded. Doing the encryption
    // here is both correct and visible.
    const ciphertext = await signer.nip44.encrypt(pubkey, JSON.stringify(encodeRailLayout(layout)));
    const draft = await finalizeDraft({
      kind: RAIL_LAYOUT_KIND,
      created_at: createdAt,
      tags: [['d', RAIL_LAYOUT_D_TAG]],
      content: ciphertext
    });

    // The guard the precedent has nowhere. It reads the draft's own content,
    // NOT a decrypt of it: applesauce caches the plaintext on an encrypted
    // draft under a symbol, so unlocking the object we just encrypted returns
    // that plaintext without decrypting and would agree with us
    // unconditionally. This proves only "not plaintext JSON" — but that is
    // exactly the disclosure being prevented, and an event unreadable for any
    // other reason lands in `locked` rather than being taken for an empty rail.
    if (getAppDataEncryption(draft) !== 'nip44') {
      blocked = true;
      return { published: false, reason: 'not-encrypted' };
    }

    signed = await signer.signEvent(draft);
  } catch {
    // No plaintext fallback exists here on purpose. A layout that cannot be
    // encrypted is not published.
    blocked = true;
    return { published: false, reason: 'sign-failed' };
  }

  // publishEvent RESOLVES on rejection — it contains no throw at all — so the
  // return value is the only evidence anything was accepted. Discarding it,
  // as the precedent does, makes "every relay refused" look identical to
  // "saved".
  const result = await publishEvent(signed);
  if (!result?.success) {
    blocked = true;
    return { published: false, reason: 'rejected' };
  }

  eventStore.add(signed);
  remoteStamp = { created_at: signed.created_at, id: signed.id };
  remoteLayout = layout;
  status = RAIL_SYNC_STATUS.loaded;
  blocked = false;
  return { published: true };
}

/** Drop every subscription and forget this account's remote state. */
export function cleanupRailLayoutSync() {
  for (const sub of subscriptions) {
    try {
      sub.unsubscribe();
    } catch {
      /* a subscription that is already gone is not a problem */
    }
  }
  subscriptions = [];
  status = RAIL_SYNC_STATUS.idle;
  remoteLayout = null;
  remoteStamp = null;
  activePubkey = null;
  blocked = false;
}
