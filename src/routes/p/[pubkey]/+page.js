import { error, redirect } from '@sveltejs/kit';
import { normalizeToHex, hexToNpub } from '$lib/helpers/nostrUtils';
import { isNip05Address, resolveNip05 } from '$lib/helpers/nip05-verify.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export async function load({ params }) {
  // /p/<name@domain>: a verified address works as a link into edufeed, like
  // njump.me/<address>. Client-only route, so the lookup can run here.
  if (isNip05Address(params.pubkey)) {
    const resolved = await resolveNip05(params.pubkey);
    if (!resolved) {
      throw error(404, `No Nostr profile is published for ${params.pubkey.trim().toLowerCase()}`);
    }
    redirect(307, `/p/${hexToNpub(resolved)}`);
  }

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
