// Tiny rune-backed test double: a plain `{ value }` box (the shape most
// mocks in this codebase already use) but backed by a real $state signal.
// Needed when a hook under test tracks a mocked getter (e.g. getActiveUser())
// inside its own $effect/$derived — a plain object's `.value` read is
// invisible to Svelte's reactivity, so the effect would only ever see the
// value as of mount and never re-run when a test mutates it later.
/** @param {any} initial */
export function createReactiveBox(initial) {
  let current = $state(initial);
  return {
    get value() {
      return current;
    },
    set value(v) {
      current = v;
    }
  };
}
