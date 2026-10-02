// "Is this call view on screen?" — the bookkeeping behind the call store's
// stage counter (registerCallStageView), shared by the stage itself and the
// channel's own connecting / failed / ended call views (QA 2026-10-02 B4/C2:
// only a mounted stage counted, so the dock sat on top of the call page
// while it was still connecting).
//
// Registered only while the node has layout: below md the channel's
// "‹ Kanäle" hides the chat with display:none and the view stays mounted,
// which must not keep the dock away (review 2026-10-02). The observer comes
// from the node's own document, so a stage in the pop-out window reports
// its own size. Without ResizeObserver (jsdom) it counts as on screen.

/**
 * @param {HTMLElement} node
 * @param {() => () => void} register returns the matching unregister
 * @returns {() => void} stop tracking (and unregister)
 */
export function trackOnScreen(node, register) {
  let off = /** @type {(() => void) | null} */ (register());
  const Observer = node.ownerDocument.defaultView?.ResizeObserver;
  const observer = Observer
    ? new Observer((entries) => {
        const box = entries[entries.length - 1]?.contentRect;
        const visible = !!box && box.width > 0 && box.height > 0;
        if (visible && !off) off = register();
        else if (!visible && off) {
          off();
          off = null;
        }
      })
    : null;
  observer?.observe(node);
  return () => {
    observer?.disconnect();
    off?.();
    off = null;
  };
}
