// Pure ordering helpers for the call stage's participant tiles.
//
// Raised hands queue in the order they went up (first raised = first) and
// those seats move to the front of the stage; lowering a hand puts the seat
// back in its normal place.

/**
 * Record a hand going up or down. A hand that is already up keeps its first
 * raise time (a re-sent "up" to a late joiner must not reorder the queue).
 * @param {Map<string, number>} times identity -> raise time (ms)
 * @param {string} identity
 * @param {boolean} raised
 * @param {number} at raise time (ms)
 * @returns {Map<string, number>} a new map
 */
export function withHand(times, identity, raised, at) {
  const next = new Map(times);
  if (raised) {
    if (!next.has(identity)) next.set(identity, at);
  } else {
    next.delete(identity);
  }
  return next;
}

/**
 * The raised hands, first raised first (ties broken by identity, so every
 * viewer sees the same queue).
 * @param {Map<string, number>} times
 * @returns {string[]}
 */
export function handQueue(times) {
  return [...times.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([identity]) => identity);
}

/**
 * The seats in stage order.
 *
 * Rule (Task 19): a tile the user placed by hand (drag and drop, Alt+arrow)
 * keeps that slot — `placements` maps it to its index in the final order.
 * Everyone else flows around those slots: raised hands first (queue order),
 * then the base order, so a new participant lands at the end. A raised hand
 * therefore promotes only tiles the user has not moved.
 *
 * @param {string[]} baseKeys seats in their natural order
 * @param {string[]} handKeys raised hands, queue order (may name seats not on stage)
 * @param {Map<string, number>} [placements] manually placed seat -> index
 * @returns {string[]}
 */
export function orderSeats(baseKeys, handKeys, placements = new Map()) {
  const present = new Set(baseKeys);
  const placed = [...placements.entries()]
    .filter(([k]) => present.has(k))
    .sort((a, b) => a[1] - b[1]);
  const fixed = new Set(placed.map(([k]) => k));
  const promoted = handKeys.filter((k) => present.has(k) && !fixed.has(k));
  const up = new Set(promoted);
  const order = [...promoted, ...baseKeys.filter((k) => !up.has(k) && !fixed.has(k))];
  for (const [key, index] of placed) {
    order.splice(Math.min(Math.max(0, index), order.length), 0, key);
  }
  return order;
}

/**
 * Move one seat to `toIndex` of the current stage order and return the new
 * placements: the moved seat and every seat placed before keep their exact
 * slots in the resulting order (seats no longer on stage are dropped).
 * @param {string[]} currentOrder the order on screen (orderSeats' result)
 * @param {string} key
 * @param {number} toIndex
 * @param {Map<string, number>} placements
 * @returns {Map<string, number>} new placements (the same map when `key` is unknown)
 */
export function moveSeat(currentOrder, key, toIndex, placements) {
  const from = currentOrder.indexOf(key);
  if (from < 0) return placements;
  const order = currentOrder.filter((k) => k !== key);
  order.splice(Math.min(Math.max(0, toIndex), order.length), 0, key);
  /** @type {Map<string, number>} */
  const next = new Map();
  for (const k of [...placements.keys(), key]) {
    const i = order.indexOf(k);
    if (i >= 0) next.set(k, i);
  }
  return next;
}
