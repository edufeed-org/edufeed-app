/**
 * Pure decision behind the "new version available" toast in the root layout.
 *
 * The toast is shown at most once per page lifetime (`prompted`), and never
 * while a call is live: a reload mid-conference would drop the user out of
 * the room, so the prompt waits until the call phase returns to idle.
 *
 * @param {{ updateAvailable: boolean, inCall: boolean, prompted: boolean }} input
 * @returns {boolean} true when the toast should be shown now
 */
export function shouldPromptUpdate({ updateAvailable, inCall, prompted }) {
  return Boolean(updateAvailable) && !inCall && !prompted;
}
