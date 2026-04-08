let hasHistory = false;

/**
 * Record that an in-app navigation occurred.
 * Called from afterNavigate in +layout.svelte.
 * @param {{ url: URL } | null | undefined} from
 */
export function recordNavigation(from) {
  if (from?.url) hasHistory = true;
}

/**
 * Whether at least one in-app navigation has occurred.
 * Used to guard history.back() against navigating to an external site.
 * @returns {boolean}
 */
export function getHasHistory() {
  return hasHistory;
}

/** Reset state (for testing only) */
export function _reset() {
  hasHistory = false;
}
