/**
 * Pure helpers for OS-level (browser Notification API) toasts. Shared by the
 * Concord channel toasts, the DM toasts and the inbox toasts so every source
 * applies the same suppression rules — each branch is unit-tested in
 * system-notifications.test.js.
 */

/**
 * The complete OS-toast gate, pure so every branch is unit-testable.
 * `startTime` is the service start in unix SECONDS (cache-replay guard);
 * `lastToastAt`/`now` are Date.now() MILLISECONDS (throttle).
 *
 * `level`/`isMention` are the per-channel Concord levels; sources without
 * levels (DMs, inbox) leave them out and get 'all'. `isActiveChannel` is
 * "the user is looking at the surface this item lands on" — a visible tab on
 * that surface never toasts, the badge there is enough.
 * @param {{createdAt: number, isMention?: boolean, level?: 'all'|'mentions'|'nothing',
 *   enabled: boolean, permissionGranted: boolean, tabVisible: boolean,
 *   isActiveChannel: boolean, marker: number, startTime: number,
 *   lastToastAt: number, now: number, throttleMs?: number}} args
 * @returns {boolean}
 */
export function shouldToast(args) {
  const throttleMs = args.throttleMs ?? 30_000;
  const level = args.level ?? 'all';
  if (!args.enabled || !args.permissionGranted) return false;
  if (level === 'nothing') return false;
  if (level === 'mentions' && !args.isMention) return false;
  if (args.createdAt <= args.marker) return false;
  if (args.createdAt <= args.startTime) return false;
  if (args.tabVisible && args.isActiveChannel) return false;
  if (args.now - args.lastToastAt < throttleMs) return false;
  return true;
}

/**
 * Whether the browser can show OS notifications at all (SSR, tests and
 * some in-app browsers have no Notification API).
 * @returns {boolean}
 */
export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

/**
 * Which surface a pathname belongs to, for the "already looking at it"
 * suppression: '/c/messages' (and sub-paths) is the DM view, '/c/inbox' the
 * notification inbox. Everything else is neither.
 * @param {string} pathname
 * @returns {'dm' | 'inbox' | null}
 */
export function surfaceForPath(pathname) {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/c/messages' || path.startsWith('/c/messages/')) return 'dm';
  if (path === '/c/inbox' || path.startsWith('/c/inbox/')) return 'inbox';
  return null;
}
