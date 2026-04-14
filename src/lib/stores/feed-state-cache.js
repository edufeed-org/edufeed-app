/**
 * Module-level cache for feed UI state (display limit, active filters).
 * Persists across SPA navigations regardless of layout mounting/unmounting.
 * Cleared only on full page reload.
 *
 * @type {Map<string, any>}
 */
export const feedStateCache = new Map();
