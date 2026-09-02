/**
 * Session epoch — bumped when an account switch flushes the EventStore
 * (see $lib/services/session-flush.js). +layout.svelte keys the route tree
 * on it, so the page the user is standing on remounts and refetches under
 * the new identity instead of showing the flushed (empty) store until the
 * next navigation.
 *
 * Object-literal $state so the module export stays a stable reference while
 * `.value` writes are tracked (same pattern as accountsMeta in
 * accounts.svelte.js).
 */
export const sessionEpoch = $state({ value: 0 });

export function bumpSessionEpoch() {
  sessionEpoch.value++;
}
