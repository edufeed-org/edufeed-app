import { npubToHex } from '$lib/helpers/nostrUtils.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ url }) {
  const communityParam = url.searchParams.get('community') || '';
  const communityPubkey = communityParam.startsWith('npub1')
    ? npubToHex(communityParam) || ''
    : communityParam;

  return {
    communityPubkey,
    editNaddr: url.searchParams.get('edit') || ''
  };
}
