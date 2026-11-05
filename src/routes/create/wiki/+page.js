import { normalizePubkey } from '$lib/helpers/pubkey.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ url }) {
  const communityParam = url.searchParams.get('community') || '';
  const communityPubkey = communityParam.startsWith('npub1')
    ? normalizePubkey(communityParam) || ''
    : communityParam;

  return {
    communityPubkey,
    editNaddr: url.searchParams.get('edit') || '',
    prefill: url.searchParams.get('prefill') || ''
  };
}
