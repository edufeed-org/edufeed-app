/**
 * Owned slot — a single-occupant registry whose release is scoped to the
 * claimant.
 *
 * The root layout hands slots out through context so a page or child layout
 * can publish chrome data upward (ContentNavSidebar props, "this page owns
 * the bottom UI", "this page has its own create action"). The naive shape —
 * `setX(getter)` on init, `setX(undefined)` on destroy — breaks under a
 * remount, because Svelte 5's `{#key}` block mounts the NEW branch before it
 * destroys the OLD one (BranchManager.ensure → #commit): the old teardown
 * ran after the new registration and wiped it. That is what happened on an
 * account switch — +layout.svelte keys the route tree on the session epoch,
 * and the community's content-type/channel sidebar vanished until the next
 * navigation.
 *
 * Ownership is tracked in a PLAIN variable on purpose. Inside an effect
 * teardown Svelte serves `$state` reads from its pre-batch snapshot
 * (`old_values` in runtime.js), so a reactive `current === value` check
 * would still see the old occupant and clear the slot. The reactive field
 * is only a mirror for templates to read.
 *
 * @template T
 * @returns {{ readonly value: T | undefined, claim: (value: T) => () => void }}
 */
export function createOwnedSlot() {
  /** @type {T | undefined} identity truth — not reactive, see above */
  let owner;
  /** @type {T | undefined} reactive mirror for templates/deriveds */
  let current = $state.raw(undefined);
  return {
    get value() {
      return current;
    },
    /**
     * Occupy the slot. Returns a release function that is a no-op once a
     * later claim has taken over.
     * @param {T} value
     */
    claim(value) {
      owner = value;
      current = value;
      return () => {
        if (owner !== value) return;
        owner = undefined;
        current = undefined;
      };
    }
  };
}
