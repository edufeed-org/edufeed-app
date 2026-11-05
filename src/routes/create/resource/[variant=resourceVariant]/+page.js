import { normalizePubkey } from '$lib/helpers/pubkey.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ params, url }) {
  const communityParam = url.searchParams.get('community') || '';
  // Accept both npub (bech32) and hex formats
  const communityPubkey = communityParam.startsWith('npub1')
    ? normalizePubkey(communityParam) || ''
    : communityParam;

  return {
    variantId: params.variant,
    communityPubkey,
    editNaddr: url.searchParams.get('edit') || ''
  };
}
