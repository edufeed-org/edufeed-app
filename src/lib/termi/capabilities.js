// What Termi offers this person: the cards of the empty chat and the rows of the
// "what's new" dialog. Host-free; copy and actions live with the components.

/**
 * @typedef {{ id: 'material' | 'lesson' | 'import' } | { id: 'more', locked: 'login' | 'address' }} CapabilityCard
 */

/**
 * @param {{ ai: boolean, llm: boolean, loggedIn: boolean, eligible: boolean | undefined }} who
 *   `eligible` is undefined while the probe runs: nothing is promised or withheld yet.
 * @returns {CapabilityCard[]}
 */
export function capabilityCards({ ai, llm, loggedIn, eligible }) {
  if (!ai) return [];
  /** @type {CapabilityCard[]} */
  const cards = [{ id: 'material' }];
  if (!llm) return cards;
  if (!loggedIn) cards.push({ id: 'more', locked: 'login' });
  else if (eligible === true) cards.push({ id: 'lesson' }, { id: 'import' });
  else if (eligible === false) cards.push({ id: 'more', locked: 'address' });
  return cards;
}

/**
 * The first announcement this device has not shown yet.
 * @template {{ id: string, when: (ctx: any) => boolean }} A
 * @param {A[]} list
 * @param {string[]} seen
 * @param {any} ctx
 * @returns {A | undefined}
 */
export function pendingAnnouncement(list, seen, ctx) {
  return list.find((a) => !seen.includes(a.id) && a.when(ctx));
}
