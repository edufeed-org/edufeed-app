import { redirect, error } from '@sveltejs/kit';
import { resolveNostrShortcutRoute } from '$lib/helpers/nostrShortcutRoute';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export function load({ params }) {
  const target = resolveNostrShortcutRoute(params.nostrShortcut);
  if (!target) throw error(400, 'Invalid Nostr identifier');
  throw redirect(307, target);
}
