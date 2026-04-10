/**
 * Svelte action for swipe-to-reply gesture on message bubbles.
 * Detects horizontal touch swipes and calls onSwipe when threshold is exceeded.
 *
 * @param {HTMLElement} node
 * @param {{ onSwipe: () => void, threshold?: number, direction?: 'left' | 'right' }} params
 */
export function swipeable(node, { onSwipe, threshold = 60, direction = 'right' }) {
  let startX = 0;
  let currentX = 0;
  let swiping = false;

  /** @param {TouchEvent} e */
  function handleTouchStart(e) {
    const touch = e.touches[0];
    startX = touch.clientX;
    currentX = startX;
    swiping = true;
    node.style.transition = 'none';
  }

  /** @param {TouchEvent} e */
  function handleTouchMove(e) {
    if (!swiping) return;
    const touch = e.touches[0];
    currentX = touch.clientX;
    const deltaX = currentX - startX;

    // Only allow movement in the configured direction
    const validDelta = direction === 'right' ? deltaX : -deltaX;
    if (validDelta <= 0) {
      node.style.transform = '';
      return;
    }

    // Cap visual displacement
    const capped = Math.min(validDelta, threshold * 1.5);
    const translateX = direction === 'right' ? capped : -capped;
    node.style.transform = `translateX(${translateX}px)`;
  }

  /** @param {TouchEvent} e */
  function handleTouchEnd(e) {
    if (!swiping) return;
    swiping = false;

    const endX = e.changedTouches[0].clientX;
    const deltaX = endX - startX;
    const distance = direction === 'right' ? deltaX : -deltaX;

    // Reset transform with animation
    node.style.transition = 'transform 0.2s ease-out';
    node.style.transform = '';

    if (distance >= threshold) {
      try {
        navigator.vibrate?.(10);
      } catch {
        /* ignore */
      }
      onSwipe();
    }
  }

  node.addEventListener('touchstart', handleTouchStart, { passive: true });
  node.addEventListener('touchmove', handleTouchMove, { passive: true });
  node.addEventListener('touchend', handleTouchEnd, { passive: true });

  return {
    destroy() {
      node.removeEventListener('touchstart', handleTouchStart);
      node.removeEventListener('touchmove', handleTouchMove);
      node.removeEventListener('touchend', handleTouchEnd);
    }
  };
}
