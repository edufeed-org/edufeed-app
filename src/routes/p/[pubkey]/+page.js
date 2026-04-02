import { error } from '@sveltejs/kit';
import { normalizeToHex, hexToNpub } from '$lib/helpers/nostrUtils';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ params }) {
  const hexPubkey = normalizeToHex(params.pubkey);

  if (!hexPubkey) {
    throw error(
      400,
      'Invalid public key format. Please provide a valid hex pubkey or npub identifier.'
    );
  }

  return {
    pubkey: hexPubkey,
    npub: hexToNpub(hexPubkey),
    originalParam: params.pubkey
  };
}
