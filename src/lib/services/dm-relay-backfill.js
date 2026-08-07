/**
 * Give a user a kind 10050 NIP-17 DM relay list when they have none, so an
 * incoming reply has somewhere to land.
 *
 * A kind 10050 is replaceable, so this is a destructive write if we get it
 * wrong: a default list published on top of a real one, with a newer
 * created_at, is that list gone. The EventStore cannot tell "this user has no
 * DM relay list" from "we have not fetched it yet", so this waits for the DM
 * service's settle-aware verdict and acts only on a conclusive 'absent'.
 *
 * Two further lines of defence, for the case where the proof is wrong anyway:
 * the store is re-read at write time, and the write goes through applesauce's
 * AddDirectMessageRelay, which merges into an existing list instead of
 * replacing it. Neither replaces the proof — AddDirectMessageRelay decides via
 * the same EventStore read with only a 1s grace window, so a cold lookup slips
 * past it — but together they downgrade the worst case from "your list is
 * gone" to "a relay was added to it".
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { actionRunner } from '$lib/stores/action-runner.svelte.js';
import { AddDirectMessageRelay } from 'applesauce-actions/actions';
import { waitForDmRelayCheck } from '$lib/services/dm-service.svelte.js';
import { getDefaultDmRelays } from '$lib/helpers/relay-helper.js';
import { getDmRelaysFromEvent } from '$lib/helpers/dm.js';
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';

/**
 * Ensure the active user has a published kind 10050 DM relay list, writing one
 * only on proven absence. No-op when no user is active, the account cannot
 * sign, no default relays are configured, or the check does not conclude the
 * user has none.
 *
 * Nothing has to block on this: the sender's own 10050 is where *replies* land
 * and never routes an outgoing wrap, which is exactly what makes waiting for a
 * conclusive answer affordable. Callers should fire it alongside their work
 * rather than awaiting it.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.announce] - Tell the user we did this. On by default:
 *   the write happens as a side effect of something else, and it publishes to
 *   their public identity. Pass false from call sites that are already a
 *   direct user action with their own feedback.
 * @returns {Promise<void>}
 */
export async function ensureDmRelayList({ announce = true } = {}) {
  const account = manager.active;
  const pubkey = account?.pubkey;
  const signer = account?.signer;
  if (!pubkey || !signer) return;

  // Cheap disqualifier first — with nothing to publish there is no point
  // waiting out a settle window to find out whether we should.
  const relays = getDefaultDmRelays();
  if (!relays.length) return;

  const status = await waitForDmRelayCheck();
  if (status !== 'absent') {
    // 'present' is the ordinary path. 'checking' / 'idle' mean we never got a
    // conclusive answer — declining to write leaves the user without an inbox,
    // which the nudge can still fix; writing could destroy the list they have.
    if (status !== 'present') {
      console.warn(`[dm] kind 10050 check is '${status}' — not backfilling`);
    }
    return;
  }

  // The verdict is a moment in time; a 10050 may have arrived since. Backfill
  // when there is none OR the one there lists no relays (equally unroutable,
  // and proof in itself — an existence-only guard would leave the user stuck).
  const existing = eventStore.getReplaceable(10050, pubkey);
  if (existing && getDmRelaysFromEvent(existing).length > 0) return;

  try {
    await actionRunner.run(AddDirectMessageRelay, relays);
    if (announce) showToast(m.dm_relay_autosetup_notice(), 'info', 8000);
  } catch (err) {
    // Publish rejected by every relay, or signing failed. Say nothing rather
    // than announce an inbox the user does not have.
    console.warn('[dm] failed to backfill kind 10050:', err);
  }
}
