/**
 * CalendarNavigation period buttons (GitHub edufeed-org/edufeed-app#3)
 *
 * The list view of a bounded calendar now defaults to 'all' when the URL names
 * no period, so 'month' is no longer a universal default. Picking a period must
 * therefore always write it to the URL explicitly — otherwise clicking "Month"
 * in the list would drop the param and land right back on "All".
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
vi.mock('$app/stores', () => ({
  page: writable({
    url: new URL('http://localhost/calendar/author/abc?view=list')
  })
}));

import * as m from '$lib/paraglide/messages';
import CalendarNavigation from '../CalendarNavigation.svelte';

/** @param {string} viewMode */
function renderNav(viewMode) {
  return render(CalendarNavigation, {
    props: {
      currentDate: new Date(2026, 9, 5),
      viewMode,
      presentationViewMode: 'list',
      // communityMode skips the AddToCalendarButton (account/store heavy)
      communityMode: true,
      onViewModeChange: () => {}
    }
  });
}

/** @returns {URLSearchParams} */
function lastGotoParams() {
  const url = String(gotoMock.mock.lastCall?.[0] ?? '');
  return new URLSearchParams(url.split('?')[1] ?? '');
}

describe('CalendarNavigation period buttons', () => {
  beforeEach(() => {
    gotoMock.mockClear();
  });

  it('writes period=month explicitly when Month is picked', async () => {
    const { getAllByRole } = renderNav('all');
    await fireEvent.click(getAllByRole('button', { name: m.common_month() })[0]);
    expect(gotoMock).toHaveBeenCalled();
    expect(lastGotoParams().get('period')).toBe('month');
    expect(lastGotoParams().get('view')).toBe('list');
  });

  it('writes period=all when All is picked', async () => {
    const { getAllByRole } = renderNav('month');
    await fireEvent.click(getAllByRole('button', { name: m.common_all() })[0]);
    expect(lastGotoParams().get('period')).toBe('all');
  });

  it('hides the date navigation in the all view', () => {
    const { queryAllByRole } = renderNav('all');
    expect(queryAllByRole('button', { name: m.common_today() })).toHaveLength(0);
  });
});
