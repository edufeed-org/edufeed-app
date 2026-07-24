// Standalone page for an UNLINKED Concord membership (Concord follow-up 1):
// joined via another client (e.g. Armada) or via a bare invite link, with no
// Communikey kind 10222 pointing at it on this deployment. Same ssr=false
// posture as /invite/[naddr] — Concord's dep tree must never enter SSR
// chunks (see the @noble/hashes v2 incident, commit a9af9c87) — and the
// param is just passed through; validation happens in +page.svelte so it
// can render an in-app error state instead of the generic error page.
export const ssr = false;
export const prerender = false;

/** @param {{params: {id: string}}} ctx */
export async function load({ params }) {
  return { communityId: params.id };
}
