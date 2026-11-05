/**
 * Pull-down-to-dismiss for bottom sheets.
 *
 * The grab handle on a phone sheet promises that you can drag it down; this
 * module makes that true. `swipeDismiss` is a Svelte action for the sheet
 * element: it follows the finger with a translateY while the pointer moves
 * down, snaps back after a short slow pull and calls `onDismiss` after a long
 * pull or a quick flick (`shouldDismiss`).
 *
 * A drag may start anywhere while the sheet is scrolled to the top; once the
 * user has scrolled its content, only the handle and header (elements inside
 * a `[data-swipe-handle]` ancestor, which carry `touch-action: none`) start a
 * drag, so pulling the content down scrolls it as usual.
 */

/** Pull distance that always dismisses, capped for short sheets. */
const DISTANCE_PX = 120;
/** Fraction of the sheet height that dismisses when the sheet is short. */
const DISTANCE_FRACTION = 0.3;
/** A flick: at least this far and this fast (px/ms). */
const FLICK_MIN_PX = 24;
const FLICK_VELOCITY = 0.6;

/**
 * @param {{ dy: number, elapsed: number, height: number }} move
 *   `dy` downward travel in px (negative = upward), `elapsed` ms since the
 *   pointer went down, `height` the sheet's rendered height.
 * @returns {boolean}
 */
export function shouldDismiss({ dy, elapsed, height }) {
  if (dy <= 0) return false;
  // An unmeasured sheet (height 0, e.g. before layout) keeps the fixed threshold.
  const distance = height > 0 ? Math.min(DISTANCE_PX, height * DISTANCE_FRACTION) : DISTANCE_PX;
  if (dy >= distance) return true;
  const velocity = elapsed > 0 ? dy / elapsed : Infinity;
  return dy >= FLICK_MIN_PX && velocity >= FLICK_VELOCITY;
}

/**
 * Svelte action: make `node` (the sheet) dismissable by pulling it down.
 *
 * @param {HTMLElement} node
 * @param {{ onDismiss: () => void }} params
 */
export function swipeDismiss(node, params) {
  let onDismiss = params.onDismiss;
  /** @type {{ id: number, startY: number, startedAt: number, dy: number } | null} */
  let drag = null;

  /** @param {EventTarget | null} target */
  function fromHandle(target) {
    return target instanceof Element && !!target.closest('[data-swipe-handle]');
  }

  /**
   * Pointer capture keeps the move/up events on the sheet when the finger
   * leaves it. It throws for a pointer the browser no longer tracks (synthetic
   * events, a touch that already ended) and that must never leave the sheet
   * stuck mid-drag, so both calls are best-effort.
   * @param {'setPointerCapture' | 'releasePointerCapture'} method
   * @param {number} id
   */
  function capture(method, id) {
    try {
      node[method]?.(id);
    } catch {
      /* not an active pointer: nothing to capture or release */
    }
  }

  function reset() {
    drag = null;
    node.style.transform = '';
    node.style.transition = '';
  }

  /** @param {PointerEvent} e */
  function onPointerDown(e) {
    if (drag || e.isPrimary === false) return;
    if (node.scrollTop > 0 && !fromHandle(e.target)) return;
    drag = { id: e.pointerId, startY: e.clientY, startedAt: Date.now(), dy: 0 };
    node.style.transition = 'none';
    capture('setPointerCapture', e.pointerId);
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = Math.max(0, e.clientY - drag.startY);
    drag.dy = dy;
    node.style.transform = `translateY(${dy}px)`;
  }

  /**
   * The content keeps the default touch-action so it can scroll; on a phone
   * the browser would therefore claim a downward drag for panning and cancel
   * the pointer, and a pull that started on the content never closed the
   * sheet. While a drag is moving the sheet down, keep the touch from panning
   * (pointermove runs before touchmove for the same input). Moving up — i.e.
   * scrolling the content — stays native.
   * @param {TouchEvent} e
   */
  function onTouchMove(e) {
    if (drag && drag.dy > 0 && e.cancelable) e.preventDefault();
  }

  /** @param {PointerEvent} e */
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    const elapsed = Date.now() - drag.startedAt;
    const height = node.getBoundingClientRect().height || node.offsetHeight || 0;
    const dismiss = shouldDismiss({ dy, elapsed, height });
    reset();
    capture('releasePointerCapture', e.pointerId);
    if (dismiss) onDismiss();
  }

  /** @param {PointerEvent} e */
  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.id) return;
    reset();
    capture('releasePointerCapture', e.pointerId);
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerCancel);
  node.addEventListener('touchmove', onTouchMove, { passive: false });

  return {
    /** @param {{ onDismiss: () => void }} next */
    update(next) {
      onDismiss = next.onDismiss;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerCancel);
      node.removeEventListener('touchmove', onTouchMove);
      reset();
    }
  };
}
