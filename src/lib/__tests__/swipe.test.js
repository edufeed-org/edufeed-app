/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { swipeable } from '$lib/helpers/swipe.js';

/**
 * Dispatch a synthetic touch event on a node.
 * jsdom doesn't have Touch/TouchEvent constructors, so we use CustomEvent.
 * @param {HTMLElement} node
 * @param {string} type
 * @param {number} clientX
 */
function dispatchTouch(node, type, clientX) {
  const touchObj = { clientX, clientY: 0 };
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [touchObj] });
  Object.defineProperty(event, 'changedTouches', { value: [touchObj] });
  node.dispatchEvent(event);
}

describe('swipeable action', () => {
  it('calls onSwipe when swiped right beyond threshold', () => {
    const node = document.createElement('div');
    const onSwipe = vi.fn();
    const action = swipeable(node, { onSwipe, threshold: 60, direction: 'right' });

    dispatchTouch(node, 'touchstart', 0);
    dispatchTouch(node, 'touchmove', 70);
    dispatchTouch(node, 'touchend', 70);

    expect(onSwipe).toHaveBeenCalledOnce();
    action.destroy();
  });

  it('does not call onSwipe when distance is below threshold', () => {
    const node = document.createElement('div');
    const onSwipe = vi.fn();
    const action = swipeable(node, { onSwipe, threshold: 60, direction: 'right' });

    dispatchTouch(node, 'touchstart', 0);
    dispatchTouch(node, 'touchmove', 30);
    dispatchTouch(node, 'touchend', 30);

    expect(onSwipe).not.toHaveBeenCalled();
    action.destroy();
  });

  it('calls onSwipe when swiped left beyond threshold', () => {
    const node = document.createElement('div');
    const onSwipe = vi.fn();
    const action = swipeable(node, { onSwipe, threshold: 60, direction: 'left' });

    dispatchTouch(node, 'touchstart', 100);
    dispatchTouch(node, 'touchmove', 30);
    dispatchTouch(node, 'touchend', 30);

    expect(onSwipe).toHaveBeenCalledOnce();
    action.destroy();
  });

  it('does not trigger left swipe for right direction', () => {
    const node = document.createElement('div');
    const onSwipe = vi.fn();
    const action = swipeable(node, { onSwipe, threshold: 60, direction: 'right' });

    dispatchTouch(node, 'touchstart', 100);
    dispatchTouch(node, 'touchmove', 30);
    dispatchTouch(node, 'touchend', 30);

    expect(onSwipe).not.toHaveBeenCalled();
    action.destroy();
  });

  it('cleans up event listeners on destroy', () => {
    const node = document.createElement('div');
    const addSpy = vi.spyOn(node, 'addEventListener');
    const removeSpy = vi.spyOn(node, 'removeEventListener');
    const onSwipe = vi.fn();

    const action = swipeable(node, { onSwipe });
    const addedCount = addSpy.mock.calls.length;

    action.destroy();

    expect(removeSpy.mock.calls.length).toBe(addedCount);
  });

  it('resets transform after swipe below threshold', () => {
    const node = document.createElement('div');
    const onSwipe = vi.fn();
    const action = swipeable(node, { onSwipe, threshold: 60, direction: 'right' });

    dispatchTouch(node, 'touchstart', 0);
    dispatchTouch(node, 'touchmove', 30);
    dispatchTouch(node, 'touchend', 30);

    expect(node.style.transform).toBe('');
    action.destroy();
  });

  it('uses default threshold of 60 when not specified', () => {
    const node = document.createElement('div');
    const onSwipe = vi.fn();
    const action = swipeable(node, { onSwipe, direction: 'right' });

    dispatchTouch(node, 'touchstart', 0);
    dispatchTouch(node, 'touchmove', 61);
    dispatchTouch(node, 'touchend', 61);

    expect(onSwipe).toHaveBeenCalledOnce();
    action.destroy();
  });
});
