/**
 * Pure route/view check for whether the CURRENT route already draws its own
 * bottom-right UI (chat composer, DM input, create/edit wizard CTA) and the
 * global floating buttons (create FAB, Termi assistant, scroll-to-top,
 * dashboard tab bar) must stay out of the way.
 *
 * Excludes the `/c/messages` thread-open case, which needs a page-supplied
 * getter rather than a static route/view check — see `src/routes/+layout.svelte`.
 *
 * @param {{ pathname: string, viewParam: string | null }} args
 * @returns {boolean}
 */
export function hasStaticOwnBottomUI({ pathname, viewParam }) {
  if (pathname.startsWith('/create/')) return true;
  // Standalone Concord private-channel page — draws its own chat composer,
  // same as the community `?view=chat`/`?view=channels` tabs below.
  if (pathname.startsWith('/private/')) return true;
  // Guest call landing page (`isCallLanding` in the root layout): the call
  // and its chat composer fill the page; no create FAB, no Termi bubble.
  if (pathname.startsWith('/call/')) return true;
  // Standalone NIP-29 channel chat (`/groups/<pointer>`, e.g. "Zum Kanal"
  // from a call landing): its composer / "Beitreten" bar sits at the bottom.
  // The bare `/groups` directory keeps the FAB.
  if (/^\/groups\/[^/]+/.test(pathname)) return true;
  // Community content tabs with an inline chat composer: public chat and
  // Concord private channels both render a bottom message input.
  if (viewParam === 'chat' || viewParam === 'channels') return true;
  return false;
}
