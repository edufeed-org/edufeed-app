/**
 * "Gefolgt von Anna, Jörg +3" — which of the viewer's follows have a person
 * in their contact list (kind 3). The strongest hint for telling two people
 * of the same name apart: the one your own people follow is probably the one
 * you mean (issue 0e3ad5c7, "Wie finde ich die richtige Gina?").
 *
 * The answer is computed from the kind 3s in the EventStore. To have them,
 * `requestFollowedBy` asks the lookup relays — once per subject — for the
 * follows' contact lists that tag the subjects (`#p`), so a relay only sends
 * the lists that matter.
 */
import { Subject } from 'rxjs';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { fetchEvents } from '$lib/loaders/base.js';
import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';

/** Authors per REQ; a long follow list is split, relays cap filter sizes. */
const AUTHOR_CHUNK = 200;

/** p-tags per contact-list event, computed once per event object. */
const followSets = new WeakMap();

/**
 * @param {any} event - a kind 3
 * @returns {Set<string>}
 */
function followSetOf(event) {
  let set = followSets.get(event);
  if (!set) {
    /** @type {string[][]} */
    const tags = event.tags;
    set = new Set(tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]));
    followSets.set(event, set);
  }
  return set;
}

/**
 * The follows (in the given order) whose stored contact list has `subject`.
 * @param {string} subject
 * @param {string[]} follows - the viewer's follows
 * @returns {string[]}
 */
export function followersAmong(subject, follows) {
  /** @type {string[]} */
  const out = [];
  for (const follow of follows) {
    if (follow === subject) continue;
    const list = eventStore.getReplaceable(3, follow);
    if (list && followSetOf(list).has(subject)) out.push(follow);
  }
  return out;
}

/** Subjects asked about for the current follow list (ask-once, like trust scores). */
let asked = new Set();
/** The follow list `asked` belongs to; a different list starts over. */
let askedFor = '';
/** Fires when contact lists arrive; consumers recompute. */
export const followedByUpdates = new Subject();

/**
 * Fetch the follows' contact lists that tag subjects not asked about yet.
 * Fire-and-forget; events land in the EventStore.
 * @param {Iterable<string>} subjects
 * @param {string[]} follows
 */
export function requestFollowedBy(subjects, follows) {
  if (follows.length === 0) return;
  const signature = `${follows.length}:${follows[0]}:${follows[follows.length - 1]}`;
  if (signature !== askedFor) {
    askedFor = signature;
    asked = new Set();
  }
  const fresh = [...subjects].filter((pk) => !asked.has(pk));
  if (fresh.length === 0) return;
  for (const pk of fresh) asked.add(pk);
  const relays = getProfileLookupRelays();
  for (let i = 0; i < follows.length; i += AUTHOR_CHUNK) {
    fetchEvents(relays, {
      kinds: [3],
      authors: follows.slice(i, i + AUTHOR_CHUNK),
      '#p': fresh
    }).subscribe({
      next: () => followedByUpdates.next(undefined),
      error: () => {}
    });
  }
}

/** Test helper — forget what was asked. */
export function _resetFollowedBy() {
  asked = new Set();
  askedFor = '';
}
