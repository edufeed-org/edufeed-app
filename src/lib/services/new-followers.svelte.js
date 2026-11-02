/**
 * "X folgt dir jetzt" for the inbox (issue 891be310). Watches the contact
 * lists (kind 3) that name the user — one capped fetch per session without
 * `since` (a follow while the app was closed still counts) plus the store
 * model, which the inbox's live subscription feeds — and turns them into
 * stable inbox items through the per-device follower ledger
 * (helpers/follower-ledger.js explains why a kind 3 is not yet a follow).
 */
import { TimelineModel } from 'applesauce-core/models';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { fetchEvents } from '$lib/loaders/base.js';
import {
  parseLedger,
  recordFollowers,
  markSeeded,
  followerNotifications
} from '$lib/helpers/follower-ledger.js';

export const FOLLOWER_LEDGER_PREFIX = 'comcal:inbox:followers:';
/** Contact lists asked for per session; the newest are what matters. */
const FETCH_LIMIT = 500;

/** @param {string} pubkey */
function loadLedger(pubkey) {
  try {
    return parseLedger(localStorage.getItem(FOLLOWER_LEDGER_PREFIX + pubkey));
  } catch {
    return parseLedger(null);
  }
}

/**
 * @param {string} pubkey
 * @param {import('$lib/helpers/follower-ledger.js').FollowerLedger} ledger
 */
function saveLedger(pubkey, ledger) {
  try {
    localStorage.setItem(FOLLOWER_LEDGER_PREFIX + pubkey, JSON.stringify(ledger));
  } catch {
    // Storage full or blocked: the ledger lives for this session only.
  }
}

/**
 * @param {string} pubkey - the logged-in user
 * @param {string[]} relays - where followers' contact lists can be found
 * @param {(items: ReturnType<typeof followerNotifications>) => void} onItems
 * @param {{ now?: () => number }} [options]
 * @returns {import('rxjs').Subscription[]}
 */
export function watchNewFollowers(
  pubkey,
  relays,
  onItems,
  { now = () => Math.floor(Date.now() / 1000) } = {}
) {
  let ledger = loadLedger(pubkey);
  /** @param {typeof ledger} next */
  const update = (next) => {
    if (next === ledger) return;
    ledger = next;
    saveLedger(pubkey, ledger);
    onItems(followerNotifications(ledger, pubkey, now()));
  };
  onItems(followerNotifications(ledger, pubkey, now()));

  // Seeded once the first full look is done — even when it found nobody:
  // a brand-new account has no followers yet and must still be told about
  // its first one.
  const fetchSub = fetchEvents(relays, {
    kinds: [3],
    '#p': [pubkey],
    limit: FETCH_LIMIT
  }).subscribe({
    complete: () => update(markSeeded(ledger, now())),
    error: () => update(markSeeded(ledger, now()))
  });
  const modelSub = eventStore
    .model(TimelineModel, { kinds: [3], '#p': [pubkey] })
    .subscribe((/** @type {any[]} */ events) =>
      update(recordFollowers(ledger, events || [], pubkey))
    );
  return [fetchSub, modelSub];
}
