/**
 * Grouping of the create hub for phones: the two or three things people do
 * on a phone (a note, a bookmark, a calendar entry) as big tiles, every
 * other visible action as a compact row — nothing hidden behind a second
 * screen, no wall of eleven tiles (mobile nav round 2, canvas 6a).
 */

/** Quick tiles, in this order; an id missing from the visible actions is skipped. */
export const PHONE_QUICK_IDS = ['note', 'bookmark', 'event'];

/**
 * @template {{ id: string }} A
 * @param {A[]} visibleActions - actions after community/kind filtering, in registry order
 * @param {A[]} suggestedActions - the contextual suggestions (community routes)
 * @returns {{ suggested: A[], quick: A[], more: A[], highlightId: string }}
 *   No action shows twice: a suggestion that is a quick tile only moves the
 *   highlight to that tile, any other suggestion leaves the rows.
 */
export function phoneCreateGroups(visibleActions, suggestedActions) {
  const byId = new Map(visibleActions.map((action) => [action.id, action]));
  const quick = PHONE_QUICK_IDS.map((id) => byId.get(id)).filter((action) => action !== undefined);
  const quickIds = new Set(quick.map((action) => action.id));
  const suggested = suggestedActions.filter((action) => !quickIds.has(action.id));
  const suggestedIds = new Set(suggested.map((action) => action.id));
  const more = visibleActions.filter(
    (action) => !quickIds.has(action.id) && !suggestedIds.has(action.id)
  );
  const highlightId = suggestedActions.find((action) => quickIds.has(action.id))?.id ?? 'note';
  return { suggested, quick, more, highlightId };
}
