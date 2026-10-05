/** @vitest-environment jsdom */
/**
 * Presentation switching must not clobber the community section param.
 * In a community `?view=` selects the section (`view=calendar`), so the
 * list/grid/map buttons write `cview` there; elsewhere they keep writing
 * `view` so existing /calendar URLs stay valid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const { gotoMock, pageUrl } = vi.hoisted(() => ({
  gotoMock: vi.fn(() => Promise.resolve()),
  pageUrl: { current: new URL('http://localhost/') }
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable(/** @type {any} */ (null), (set) => {
      set({ url: pageUrl.current });
    })
  };
});
vi.mock('../AddToCalendarButton.svelte', () => ({ default: () => null }));

import CalendarNavigation from '../CalendarNavigation.svelte';

/**
 * @param {string} href
 * @param {boolean} communityMode
 * @param {string} label - aria-label substring of the button to click
 */
async function clickPresentation(href, communityMode, label) {
  pageUrl.current = new URL(href);
  window.history.replaceState({}, '', pageUrl.current.pathname + pageUrl.current.search);
  const { getAllByRole } = render(CalendarNavigation, {
    props: {
      currentDate: new Date(2026, 9, 5),
      viewMode: 'month',
      presentationViewMode: 'list',
      communityMode,
      onViewModeChange: () => {}
    }
  });
  const button = getAllByRole('button').find((b) => b.getAttribute('aria-label') === label);
  if (!button) throw new Error(`button ${label} not found`);
  await fireEvent.click(button);
  const target = String(/** @type {any} */ (gotoMock.mock.calls.at(-1))?.[0]);
  return new URL(target, 'http://localhost').searchParams;
}

describe('CalendarNavigation presentation param', () => {
  beforeEach(() => gotoMock.mockClear());

  it('community mode: writes cview and keeps the section ?view=calendar', async () => {
    const { calendar_navigation_map_view } = await import('$lib/paraglide/messages');
    const params = await clickPresentation(
      'http://localhost/c/npub1abc?view=calendar',
      true,
      calendar_navigation_map_view()
    );
    expect(params.get('view')).toBe('calendar');
    expect(params.get('cview')).toBe('map');
  });

  it('global calendar: still writes ?view=', async () => {
    const { calendar_navigation_map_view } = await import('$lib/paraglide/messages');
    const params = await clickPresentation(
      'http://localhost/calendar',
      false,
      calendar_navigation_map_view()
    );
    expect(params.get('view')).toBe('map');
    expect(params.get('cview')).toBeNull();
  });
});
