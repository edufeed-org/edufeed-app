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
 * The seats in stage order: raised hands first (queue order), then everyone
 * else in the base order.
 * @param {string[]} baseKeys seats in their natural order
 * @param {string[]} handKeys raised hands, queue order (may name seats not on stage)
 * @returns {string[]}
 */
export function orderSeats(baseKeys, handKeys) {
  const present = new Set(baseKeys);
  const promoted = handKeys.filter((k) => present.has(k));
  const up = new Set(promoted);
  return [...promoted, ...baseKeys.filter((k) => !up.has(k))];
}
