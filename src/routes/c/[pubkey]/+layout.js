import { normalizePubkey, hexToNpub } from '$lib/helpers/pubkey.js';
import { error, redirect } from '@sveltejs/kit';

/**
 * Layout load function to validate and canonicalize the community identifier.
 * Shared by all child routes under /c/[pubkey]/
 *
 * npub is the canonical form. A raw hex pubkey is gracefully redirected to its
 * npub URL (preserving sub-path + query) rather than rejected, so old links and
 * notifications that still carry hex pubkeys keep working.
 * @type {import('./$types').LayoutLoad}
 */
export async function load({ params, url }) {
  const { pubkey } = params;

  const hexPubkey = normalizePubkey(pubkey);

  if (!hexPubkey) {
    throw error(
      400,
      'Invalid community identifier. Community URLs should be in the format /c/npub1...'
    );
  }

  // Canonicalize: redirect any non-npub form (hex) to the npub URL.
  if (!pubkey.startsWith('npub1')) {
    const npub = hexToNpub(hexPubkey);
    if (npub) {
      const target = url.pathname.replace(`/c/${pubkey}`, `/c/${npub}`) + url.search;
      throw redirect(308, target);
    }
  }

  return {
    pubkey: hexPubkey,
    npub: pubkey
  };
}
