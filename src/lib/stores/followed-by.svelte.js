/**
 * Reactive hook: for the people on screen, which of the viewer's follows
 * follow them — "Gefolgt von Anna, Jörg +3" (loaders/followed-by.js).
 *
 * Same contract as useTrustScores: a getter for a Map that is replaced only
 * when an entry changed (consumers re-render from it; a fresh Map per pass
 * would loop), subjects requested once. People nobody among the follows
 * follows are left out.
 *
 * MUST be called during component init (it uses $effect).
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- plain Map snapshots, replaced wholesale */
import { contactsStore } from '$lib/stores/contacts.svelte.js';
import { requestFollowedBy, followersAmong, followedByUpdates } from '$lib/loaders/followed-by.js';

/**
 * @param {() => Iterable<string>} getPubkeys - reactive getter for the people on screen
 * @returns {() => Map<string, string[]>}
 */
export function useFollowedBy(getPubkeys) {
  /** @type {string[]} current subjects (plain — read inside the subscription) */
  let current = [];
  /** @type {string[]} */
  let follows = [];
  let map = $state.raw(/** @type {Map<string, string[]>} */ (new Map()));
  /** Plain mirror of `map` for the change check (see useTrustScores). */
  let published = new Map();

  function snapshot() {
    const next = new Map();
    for (const pk of current) {
      const followers = followersAmong(pk, follows);
      if (followers.length > 0) next.set(pk, followers);
    }
    const same =
      next.size === published.size &&
      [...next].every(([pk, v]) => published.get(pk)?.join() === v.join());
    if (same) return;
    published = next;
    map = next;
  }

  $effect(() => {
    current = [...(getPubkeys() ?? [])].filter((pk) => typeof pk === 'string');
    follows = contactsStore.contacts;
    requestFollowedBy(current, follows);
    snapshot();
  });

  $effect(() => {
    const sub = followedByUpdates.subscribe(() => snapshot());
    return () => sub.unsubscribe();
  });

  return () => map;
}
