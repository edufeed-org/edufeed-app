/**
 * Hidden calendar sources — bulk publishers whose events would otherwise
 * drown the global calendar: our own event mirrors (bildungsserver, OER
 * World Map, ev-bildung crawlers), imported course catalogues.
 *
 * One signal, opt-in to show: the deployment's `CALENDAR_HIDDEN_PUBKEYS`
 * (npub / hex / kind 30000 list naddrs, see `pubkey-lists`). A NIP-24
 * `bot: true` profile does NOT hide an author by itself — being a bot is not
 * the problem, flooding is, and that is the operator's call per source (OER
 * World Map is a bot and wanted on the calendar; laoc, 2026-10-24). The
 * global calendar, /discover events and the landing panel hide these by
 * default and offer "Importierte Termine anzeigen"
 * (`appSettings.showHiddenCalendarSources`). Community calendars are not
 * filtered: an h-tagged event was placed there on purpose.
 */
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { createPubkeyList } from '$lib/services/pubkey-lists.svelte.js';

/** @type {import('$lib/services/pubkey-lists.svelte.js').PubkeyList | null} */
let list = null;

/** Read `CALENDAR_HIDDEN_PUBKEYS`; call once after the config is ready. */
export async function initCalendarHiddenSources() {
  const entries = runtimeConfig.calendarHiddenPubkeys || [];
  if (entries.length === 0 || list) return list?.ready;
  list = createPubkeyList('calendar-hidden', entries);
  await list.ready;
}

/** @param {string | undefined} pubkey */
export function isHiddenCalendarSource(pubkey) {
  if (!pubkey) return false;
  return !!list && list.has(pubkey);
}

/** Bumps when the configured list resolves (read in a $derived). */
export function getHiddenCalendarSourcesVersion() {
  return list?.version ?? 0;
}

/**
 * Split calendar events (raw or transformed; both carry `pubkey`) into the
 * ones to show and the count of hidden ones. With `showHidden` everything is
 * shown and `hidden` still reports how many came from hidden sources.
 *
 * @template {{ pubkey: string }} T
 * @param {T[]} events
 * @param {{ showHidden?: boolean }} [options]
 * @returns {{ shown: T[], hidden: number }}
 */
export function partitionHiddenCalendarSources(events, { showHidden = false } = {}) {
  let hidden = 0;
  for (const e of events) if (isHiddenCalendarSource(e.pubkey)) hidden++;
  if (hidden === 0 || showHidden) return { shown: events, hidden };
  return { shown: events.filter((e) => !isHiddenCalendarSource(e.pubkey)), hidden };
}

export function _resetCalendarSourcesForTesting() {
  list = null;
}
