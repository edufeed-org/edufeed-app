/**
 * Reactive "is this person in my network?" (helpers/network-trust.js) over
 * the viewer's follows (contactsStore), the deployment's curated/WoT authors
 * and the follows' contact lists (loaders/followed-by.js). Readable inside
 * $derived/$effect and from services: it re-runs when follows, curated
 * authors or follows' contact lists arrive. Until they have, a person is a
 * stranger — the safe side for blurring.
 */
import { contactsStore } from '$lib/stores/contacts.svelte.js';
import { followersAmong, requestFollowedBy, followedByUpdates } from '$lib/loaders/followed-by.js';
import {
  getCuratedAuthors,
  getCuratedCacheVersion
} from '$lib/services/curated-authors-service.svelte.js';
import { CATEGORIES } from '$lib/services/app-relay-service.svelte.js';
import { isInNetworkOf } from '$lib/helpers/network-trust.js';

let followedByVersion = $state(0);
followedByUpdates.subscribe(() => followedByVersion++);

/** Subjects to ask about, flushed as one request per microtask (a list of rows). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain buffer, not reactive
let pending = new Set();
/** @param {string} pubkey @param {string[]} follows */
function askLater(pubkey, follows) {
  if (pending.size === 0) {
    // Deferred: isInNetwork runs inside $derived and the answer bumps state.
    queueMicrotask(() => {
      const subjects = pending;
      pending = new Set();
      requestFollowedBy(subjects, follows);
    });
  }
  pending.add(pubkey);
}

/**
 * @param {string} pubkey
 * @param {string | undefined} self - the active user's pubkey
 * @returns {boolean}
 */
export function isInNetwork(pubkey, self) {
  void followedByVersion;
  void getCuratedCacheVersion();
  const follows = contactsStore.contacts;
  return isInNetworkOf(pubkey, {
    self,
    follows,
    trusted: Object.keys(CATEGORIES).flatMap((c) => getCuratedAuthors(c) ?? []),
    followedByFollows: (pk) => {
      askLater(pk, follows);
      return followersAmong(pk, follows).length;
    }
  });
}
