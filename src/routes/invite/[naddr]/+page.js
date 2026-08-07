// Join-by-link landing page. Concord invite links (created by createInvite,
// see ChannelInviteSheet.svelte) are `${origin}/invite/<naddr>#<fragment>` —
// the fragment (bootstrap relays + token) is NOT sent to the server and
// never touches load(); the naddr is a pass-through only used to render the
// link, the actual join reads window.location.href client-side.
export const ssr = false;
export const prerender = false;

/** @param {{params: {naddr: string}}} ctx */
export async function load({ params }) {
  return { naddr: params.naddr };
}
