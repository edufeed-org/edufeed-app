/**
 * Test double for `$lib/helpers/message-lookup.js`.
 *
 * The real module references ~30 messages statically at import time, which
 * throws under a partial `vi.mock('$lib/paraglide/messages', …)` (vitest's
 * strict mock rejects missing exports). This double resolves against whatever
 * messages mock the suite installed, so "key not mocked → undefined → raw-key
 * fallback" keeps working exactly like the real registry-miss path.
 *
 * Use: vi.mock('$lib/helpers/message-lookup.js', () => import('$lib/__tests__/__mocks__/message-lookup.js'));
 */
import * as m from '$lib/paraglide/messages';

/** @param {string} key */
export function resolveMessage(key) {
  if (!Object.prototype.hasOwnProperty.call(m, key)) return undefined;
  const fn = /** @type {Record<string, any>} */ (m)[key];
  return typeof fn === 'function' ? fn() : undefined;
}
