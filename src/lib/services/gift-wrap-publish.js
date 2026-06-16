/**
 * NIP-17 gift-wrap publishing.
 *
 * A kind 1059 gift wrap MUST only be published to the recipient's chosen DM
 * relays (kind 10050), per NIP-17. The generic outbox publisher is wrong for
 * gift wraps: the wrapper pubkey is a throwaway random key (so an outbox lookup
 * finds nothing and falls back to the app fallback relays), which both leaks DM
 * metadata to relays the recipient never chose and wastes a relay-list lookup.
 *
 * The applesauce SendWrappedMessage action already resolves each recipient's DM
 * relays and passes them as `relays`. We publish to exactly those. If the action
 * couldn't resolve any (recipient has no kind 10050 / 10002 in the store), we
 * fall back to the recipient's read relays derived from the gift wrap's `p` tag.
 */
import { pool as defaultPool } from '$lib/stores/nostr-infrastructure.svelte';
import { getReadRelays as defaultGetReadRelays } from '$lib/services/relay-service.svelte.js';

export const GIFT_WRAP_KIND = 1059;

/** Per-relay publish timeout. */
const PUBLISH_TIMEOUT_MS = 5000;

/**
 * @param {import('nostr-tools').NostrEvent} event - kind 1059 gift wrap
 * @param {string[] | undefined} relays - DM relays resolved by the action
 * @param {object} [deps]
 * @param {any} [deps.pool]
 * @param {(pubkey: string) => Promise<string[]>} [deps.getReadRelays]
 * @returns {Promise<{ success: boolean, relays: string[], successCount: number }>}
 */
export async function publishGiftWrap(event, relays, deps = {}) {
  const { pool = defaultPool, getReadRelays = defaultGetReadRelays } = deps;

  let targets = Array.isArray(relays) ? relays.filter(Boolean) : [];
  if (targets.length === 0) {
    const recipient = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'p')?.[1];
    if (recipient) targets = (await getReadRelays(recipient)) || [];
  }
  targets = [...new Set(targets)];
  if (targets.length === 0) {
    return { success: false, relays: [], successCount: 0 };
  }

  const results = await Promise.allSettled(
    targets.map((url) => pool.relay(url).publish(event, { timeout: PUBLISH_TIMEOUT_MS }))
  );
  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  return { success: successCount > 0, relays: targets, successCount };
}
