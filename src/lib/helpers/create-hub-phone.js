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
 * @param {A[]} suggestedActions - the contextual "Vorgeschlagen" row (community routes)
 * @returns {{ suggested: A[], quick: A[], more: A[] }}
 */
export function phoneCreateGroups(visibleActions, suggestedActions) {
  const byId = new Map(visibleActions.map((action) => [action.id, action]));
  const quick = PHONE_QUICK_IDS.map((id) => byId.get(id)).filter((action) => action !== undefined);
  const quickIds = new Set(quick.map((action) => action.id));
  const more = visibleActions.filter((action) => !quickIds.has(action.id));
  return { suggested: suggestedActions, quick, more };
}
