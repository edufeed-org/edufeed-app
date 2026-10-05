/**
 * Calendar presentation + period selection from the URL.
 *
 * The list view of a bounded calendar (one author's events, a specific
 * calendar, a community) opens on 'all' — upcoming and past events at once —
 * instead of a single month (GitHub edufeed-org/edufeed-app#3). The global
 * calendar keeps 'month': its 'all' query has no date range and pulls every
 * calendar relay's (and, with gated mode off, every fallback relay's) whole
 * history. An explicit `period` param always wins; the grid views never
 * show 'all'.
 */

/** @typedef {'calendar' | 'list' | 'map'} PresentationView */
/** @typedef {'month' | 'week' | 'day' | 'all'} CalendarPeriod */

const PRESENTATION_VIEWS = ['calendar', 'list', 'map'];
const PERIODS = ['month', 'week', 'day', 'all'];

/**
 * Whether a CalendarView context is bounded, so its list may default to 'all'.
 * @param {{ authorPubkey?: string, calendar?: any, communityMode?: boolean, globalMode?: boolean }} ctx
 * @returns {boolean}
 */
export function listDefaultsToAllFor({ authorPubkey, calendar, communityMode } = {}) {
  return Boolean(authorPubkey || calendar || communityMode);
}

/**
 * @param {URLSearchParams} searchParams
 * @param {{ listDefaultsToAll?: boolean }} [options]
 * @returns {{ presentationView: PresentationView, period: CalendarPeriod }}
 */
export function resolveCalendarViewState(searchParams, { listDefaultsToAll = false } = {}) {
  const rawView = searchParams.get('view') || '';
  const presentationView = /** @type {PresentationView} */ (
    PRESENTATION_VIEWS.includes(rawView) ? rawView : 'list'
  );

  const defaultPeriod = presentationView === 'list' && listDefaultsToAll ? 'all' : 'month';
  const rawPeriod = searchParams.get('period') || '';
  let period = /** @type {CalendarPeriod} */ (
    PERIODS.includes(rawPeriod) ? rawPeriod : defaultPeriod
  );

  // The calendar grid has no 'all' layout
  if (presentationView === 'calendar' && period === 'all') period = 'month';

  return { presentationView, period };
}
