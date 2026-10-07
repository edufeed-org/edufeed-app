/**
 * HoverCard "hold" context: content rendered inside a HoverCard can ask the
 * card to stay open while an async action (follow, wave, …) is pending, even
 * if the pointer leaves meanwhile. Without a surrounding HoverCard the hook
 * is a no-op, so content components work the same on a plain page.
 */
import { getContext, setContext } from 'svelte';

const KEY = Symbol('hover-card-hold');

/**
 * @typedef {{ hold: (promise: Promise<unknown>) => Promise<unknown> }} HoverCardHold
 */

/**
 * Called by HoverCard during init.
 * @param {HoverCardHold} api
 */
export function provideHoverCardHold(api) {
  setContext(KEY, api);
}

/**
 * Called by content components during init. Returns a function that keeps
 * the enclosing card open until `promise` settles (and passes the promise
 * through, so `await hold(doThing())` reads naturally).
 * @returns {(promise: Promise<unknown>) => Promise<unknown>}
 */
export function useHoverCardHold() {
  /** @type {HoverCardHold | undefined} */
  const api = getContext(KEY);
  return (promise) => (api ? api.hold(promise) : promise);
}
