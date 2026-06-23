/**
 * Backfill a kind 10050 NIP-17 DM relay list for users who signed up before
 * the signup-time default existed. Call before sending a wrapped DM so the
 * sender always advertises where they can be reached.
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { getDefaultDmRelays } from '$lib/helpers/relay-helper.js';
import { buildDmRelayListEvent, getDmRelaysFromEvent } from '$lib/helpers/dm.js';

/**
 * Ensure the active user has a published kind 10050 DM relay list. No-op when
 * one already exists, no default relays are configured, or no user is active.
 * Publishing is fire-and-forget; the signed event is added to EventStore so
 * subsequent reads see it immediately.
 * @returns {Promise<void>}
 */
export async function ensureDmRelayList() {
  const account = manager.active;
  const pubkey = account?.pubkey;
  const signer = account?.signer;
  if (!pubkey || !signer) return;

  // Backfill when there is no 10050 OR the existing one is empty (e.g. the user
  // removed their last relay). An empty list leaves them unreachable, so an
  // existence-only guard would wrongly skip them.
  const existing = eventStore.getReplaceable(10050, pubkey);
  if (existing && getDmRelaysFromEvent(existing).length > 0) return;

  const relays = getDefaultDmRelays();
  if (!relays.length) return;

  try {
    const signed = await signer.signEvent(buildDmRelayListEvent(pubkey, relays));
    eventStore.add(signed);
    publishEvent(signed).catch((err) =>
      console.warn('[dm] kind 10050 backfill publish failed:', err)
    );
  } catch (err) {
    console.warn('[dm] failed to backfill kind 10050:', err);
  }
}
