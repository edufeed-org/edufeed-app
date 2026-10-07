// @ts-nocheck
/**
 * HoverCard hold context: content can keep the card open while an async
 * action is pending (follow from the profile hover card), even when the
 * pointer leaves the card meanwhile. The card closes once the action
 * settles, if the pointer is still outside.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import HoverCardHoldWrapper from './HoverCardHoldWrapper.svelte';

if (!Element.prototype.animate) {
  Element.prototype.animate = function () {
    const finished = Promise.resolve();
    const anim = {
      onfinish: null,
      cancel: vi.fn(),
      finished,
      currentTime: null,
      playState: 'finished'
    };
    finished.then(() => anim.onfinish?.());
    return anim;
  };
}

describe('HoverCard hold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function flush() {
    // Svelte reactivity + transition animation microtasks
    for (let i = 0; i < 5; i++) await tick();
  }

  async function open(utils) {
    await fireEvent.mouseEnter(utils.getByTestId('hover-card-wrapper'));
    vi.advanceTimersByTime(1);
    await tick();
    expect(utils.queryByTestId('content')).not.toBeNull();
  }

  it('stays open after pointer leave while a held promise is pending, closes once it settles', async () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    const utils = render(HoverCardHoldWrapper, { props: { promise } });
    await open(utils);

    await fireEvent.click(utils.getByTestId('hold-button'));
    await fireEvent.mouseLeave(utils.getByTestId('hover-card-wrapper'));
    vi.advanceTimersByTime(50);
    await flush();
    expect(utils.queryByTestId('content')).not.toBeNull();

    resolve();
    await flush();
    vi.advanceTimersByTime(50);
    await flush();
    expect(utils.queryByTestId('content')).toBeNull();
  });

  it('stays open after the held promise settles when the pointer never left', async () => {
    const promise = Promise.resolve();
    const utils = render(HoverCardHoldWrapper, { props: { promise } });
    await open(utils);
    await fireEvent.click(utils.getByTestId('hold-button'));
    await flush();
    vi.advanceTimersByTime(50);
    await flush();
    expect(utils.queryByTestId('content')).not.toBeNull();
  });

  it('closes normally on pointer leave without a hold', async () => {
    const utils = render(HoverCardHoldWrapper, { props: { promise: Promise.resolve() } });
    await open(utils);
    await fireEvent.mouseLeave(utils.getByTestId('hover-card-wrapper'));
    vi.advanceTimersByTime(50);
    await flush();
    expect(utils.queryByTestId('content')).toBeNull();
  });
});
