import { npubToHex } from '$lib/helpers/nostrUtils.js';
import { error } from '@sveltejs/kit';

/**
 * Layout load function to validate and convert npub parameter.
 * Shared by all child routes under /c/[pubkey]/
 * @type {import('./$types').LayoutLoad}
 */
export async function load({ params }) {
  const { pubkey } = params;

  // Validate and convert npub to hex
  const hexPubkey = npubToHex(pubkey);

  if (!hexPubkey) {
    throw error(
      400,
      'Invalid community identifier. Community URLs should be in the format /c/npub1...'
    );
  }

  return {
    pubkey: hexPubkey,
    npub: pubkey
  };
}
