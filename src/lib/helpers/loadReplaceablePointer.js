/**
 * Shared SvelteKit `load()` helper for community-scoped naddr routes.
 *
 * Decodes the `naddr` param into an applesauce-compatible address pointer
 * without blocking on a relay round-trip. The page component then drives
 * the actual event fetch via `useReplaceableEvent`, which gives a proper
 * loading state instead of the previous 3s-timeout-into-404 behavior.
 */
import { nip19 } from 'nostr-tools';
import { initializeConfig } from '$lib/stores/config.svelte.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { error } from '@sveltejs/kit';

/**
 * @param {{ params: { naddr: string }, parent: () => Promise<any> }} ctx
 * @param {string} contentView - sidebar selection passed downstream
 * @returns {Promise<{
 *   pointer: { kind: number, pubkey: string, identifier?: string, relays?: string[] },
 *   naddr: string,
 *   contentView: string
 * }>}
 */
export async function loadReplaceablePointer({ params, parent }, contentView) {
  const parentData = await parent();
  if (parentData?.config) initializeConfig(parentData.config);

  let decoded;
  try {
    decoded = nip19.decode(params.naddr);
  } catch {
    throw error(400, 'Invalid address');
  }
  if (decoded?.type !== 'naddr') throw error(400, 'Invalid address');

  const d = decoded.data;
  return {
    pointer: {
      kind: d.kind,
      pubkey: d.pubkey,
      identifier: d.identifier,
      relays: d.relays?.length ? d.relays : getAllLookupRelays()
    },
    naddr: params.naddr,
    contentView
  };
}
