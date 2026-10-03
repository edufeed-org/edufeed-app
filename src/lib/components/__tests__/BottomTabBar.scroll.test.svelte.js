/** @vitest-environment jsdom */
/**
 * BottomTabBar — the right scroll arrow follows the tab row's real size
 * (QA 2026-10-02 K7: measured once on mount, before the tabs settled, the
 * arrow stayed although every tab fit).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$lib/concord/community.svelte.js', () => ({
  useConcordCommunity: () => () => ({ enabled: false, pointer: null, membership: 'none' })
}));
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  areaUnreadState: () => ({ unread: false, mentioned: false })
}));
vi.mock('$lib/components/community/layout/community-nav.js', () => ({
  communityNavTabIds: () => ['home', 'chat', 'channels']
}));

import BottomTabBar from '$lib/components/community/layout/BottomTabBar.svelte';
import * as m from '$lib/paraglide/messages';

const event = { kind: 10222, pubkey: 'c'.repeat(64), content: '', tags: [] };

/** @type {Array<{cb: () => void, els: Element[]}>} */
let observers = [];
class FakeResizeObserver {
  /** @param {() => void} cb */
  constructor(cb) {
    this.cb = cb;
    /** @type {Element[]} */
    this.els = [];
    observers.push(this);
  }
  /** @param {Element} el */
  observe(el) {
    this.els.push(el);
  }
  disconnect() {}
  unobserve() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  observers = [];
});

describe('BottomTabBar — scroll arrows', () => {
  it('drops a stale right arrow once the tab row turns out to fit', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    // Before the tabs settle: wider than the bar.
    let scrollWidth = 500;
    const widths = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(() => scrollWidth);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
    try {
      render(BottomTabBar, {
        props: { selectedContentType: 'home', communityEvent: event, onContentTypeSelect: vi.fn() }
      });
      const right = m.community_layout_bottom_tab_bar_scroll_right();
      expect(await screen.findByRole('button', { name: right })).toBeTruthy();
      // The row settles at the bar's width; only a resize report says so.
      scrollWidth = 390;
      expect(observers.some((o) => o.els.length > 0)).toBe(true);
      for (const o of observers) o.cb();
      await waitFor(() => expect(screen.queryByRole('button', { name: right })).toBeNull());
    } finally {
      widths.mockRestore();
      client.mockRestore();
    }
  });
});
