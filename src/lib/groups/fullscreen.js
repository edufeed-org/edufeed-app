// Full screen for one call tile (a screen share or a camera seat): the same
// path for both, on the document the tile lives in — the pop-out window has
// its own.

/**
 * Whether `el` is the element currently in full screen.
 * @param {Element | null | undefined} el
 */
export function isFullscreenOf(el) {
  return !!el && el.ownerDocument.fullscreenElement === el;
}

/**
 * Enter full screen with `el`, or leave it when `el` is already there. A
 * refusal (no user gesture, iframe policy, unsupported) is logged, not
 * thrown: the tile simply stays where it is.
 * @param {Element | null | undefined} el
 */
export async function toggleFullscreen(el) {
  if (!el) return;
  const doc = el.ownerDocument;
  try {
    if (isFullscreenOf(el)) await doc.exitFullscreen();
    else await el.requestFullscreen?.();
  } catch (err) {
    console.warn('fullscreen refused:', err);
  }
}
