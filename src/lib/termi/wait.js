// The wait card's timing, mirrored from the server's fallback (src/lib/server/termi): plain numbers,
// no server import. A step that has not started after the start cut goes to the next model.

/** The card shows once a model has not started for this long (the server's notice comes then too). */
export const WAIT_NOTICE_MS = 8_000;
/** Per task: the wait before the next model takes over. */
export const START_CUT_MS = { ask: 30_000, lesson: 90_000 };
/** Per task: the wait on the last candidate before the request ends. */
export const LAST_CUT_MS = { ask: 90_000, lesson: 150_000 };

/**
 * "in etwa {seconds} Sekunden": what is left of the cut, rounded to 5, never below 5.
 * @param {'ask'|'lesson'} task @param {boolean} last no model takes over @param {number} elapsedMs
 */
export function waitSeconds(task, last, elapsedMs) {
  const cut = (last ? LAST_CUT_MS : START_CUT_MS)[task] ?? START_CUT_MS.ask;
  return Math.max(5, Math.round((cut - elapsedMs) / 5_000) * 5);
}
