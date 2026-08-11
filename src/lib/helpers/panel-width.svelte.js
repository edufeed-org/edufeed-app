// Drag-to-resize width for a right-hand side panel (laoc, 2026-08-11 —
// common chat UX). Persisted per storage key: a panel width is a stable
// preference, unlike a scroll position. Clamped so a corrupt stored value
// cannot wedge the layout.

/**
 * @param {string} storageKey
 * @param {{initial?: number, min?: number, max?: number}} [options]
 * @returns {{ readonly width: number, startResize: (event: PointerEvent) => void }}
 */
export function usePanelWidth(storageKey, { initial = 384, min = 280, max = 900 } = {}) {
  const stored = (() => {
    if (typeof localStorage === 'undefined') return null;
    const value = Number(localStorage.getItem(storageKey));
    return value >= min && value <= max ? value : null;
  })();
  let width = $state(stored ?? initial);

  /** @param {PointerEvent} event */
  function startResize(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (/** @type {PointerEvent} */ ev) => {
      // The panel sits on the right, so dragging LEFT grows it.
      width = Math.min(max, Math.max(min, startWidth + (startX - ev.clientX)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(storageKey, String(width));
      } catch {
        /* storage full/blocked — the session width still applies */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return {
    get width() {
      return width;
    },
    startResize
  };
}
