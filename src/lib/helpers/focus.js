/**
 * Svelte action: focus the node the moment it enters the DOM.
 *
 * For inputs that are created fresh when their dialog opens (no keyed
 * reuse), an on-mount focus is exactly "focus when the dialog opens" —
 * without the `autofocus` attribute, which the a11y linter rejects.
 *
 * Focuses immediately AND once more on the next animation frame: the
 * community route mounts its responsive variants in quick succession, and
 * the post-mount reparenting drops a synchronous-only focus back to <body>.
 *
 * @param {HTMLElement} node
 */
export function focusOnMount(node) {
  node.focus();
  const raf = requestAnimationFrame(() => {
    if (node.isConnected) node.focus();
  });
  return {
    destroy() {
      cancelAnimationFrame(raf);
    }
  };
}
