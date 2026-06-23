/**
 * Build / publish a default kind 10002 NIP-65 relay list for users who have
 * none. A relay list tells the network where to find a user's content and where
 * to reach them; without one the outbox model and NIP-17 inbox delivery break.
 *
 * Built via applesauce's EventFactory + addMailboxRelay (bare r tags = read+write).
 * We deliberately do NOT use the CreateMailboxes action: it throws when any 10002
 * already exists. Building a fresh event and relying on replaceable semantics
 * also handles the empty-list case (newer created_at wins).
 */
import { addMailboxRelay } from 'applesauce-core/operations/mailboxes';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { getDefaultRelayList } from '$lib/helpers/relay-helper.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { publishEvent } from '$lib/services/publish-service.js';

/**
 * Build and sign a default kind 10002 from the configured default relays.
 * Returns the signed event, or null when no default relays are configured.
 * Does not add to EventStore or publish.
 * @param {{ signEvent: (template: any) => Promise<any> }} signer
 * @returns {Promise<any | null>}
 */
export async function buildSignedDefaultRelayList(signer) {
  const relays = getDefaultRelayList();
  if (!relays.length) return null;
  const factory = createAppEventFactory();
  const template = await factory.build(
    { kind: 10002 },
    ...relays.map((url) => addMailboxRelay(url))
  );
  return signer.signEvent(template);
}

/**
 * Build, sign, locally add, and fire-and-forget publish a default kind 10002.
 * No-op (returns null) when no default relays are configured.
 * @param {{ signEvent: (template: any) => Promise<any> }} signer
 * @returns {Promise<any | null>}
 */
export async function publishDefaultRelayList(signer) {
  const signed = await buildSignedDefaultRelayList(signer);
  if (!signed) return null;
  eventStore.add(signed);
  publishEvent(signed).catch((err) =>
    console.warn('[relays] kind 10002 default publish failed:', err)
  );
  return signed;
}
