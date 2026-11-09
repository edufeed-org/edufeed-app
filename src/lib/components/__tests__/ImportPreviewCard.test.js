/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import ImportPreviewCard from '$lib/components/assistant/import/ImportPreviewCard.svelte';

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
overwriteGetLocale(() => 'de');

/** @param {string} key @param {object} [extra] */
const ev = (key, extra = {}) => ({
  key,
  dTag: key,
  title: `Termin ${key}`,
  startDate: '2026-12-01',
  startTime: '19:00',
  endDate: '2026-12-01',
  allDay: false,
  kind: 31923,
  ...extra
});

const EVENTS = [
  ev('a'),
  ev('b', { location: 'Aula' }),
  ev('row-2', { dTag: undefined, startDate: '', problem: 'date' }),
  ev('c'),
  ev('d')
];

/** @param {object} state */
function renderCard(state) {
  const props = {
    state: {
      source: 'plan.xlsx',
      size: '12 KB',
      status: 'preview',
      withDescriptions: false,
      done: 0,
      ...state
    },
    onUpdate: vi.fn(),
    onPublish: vi.fn(),
    onRetry: vi.fn()
  };
  return { view: render(ImportPreviewCard, { props: /** @type {any} */ (props) }), props };
}

describe('ImportPreviewCard', () => {
  it('lists every row, ticks the selected ones, explains problem and already rows', async () => {
    const { view, props } = renderCard({
      events: EVENTS,
      selected: new Set(['a', 'b', 'c']),
      already: new Set(['d'])
    });
    const rows = view.getAllByTestId('termi-import-row');
    expect(rows).toHaveLength(5);
    const boxes = /** @type {HTMLInputElement[]} */ (view.getAllByRole('checkbox'));
    expect(boxes.filter((b) => b.checked)).toHaveLength(3);
    const problemBox = /** @type {HTMLInputElement} */ (rows[2].querySelector('input'));
    expect(problemBox.disabled).toBe(true);
    expect(rows[2].textContent).toContain('Datum nicht erkannt');
    const alreadyBox = /** @type {HTMLInputElement} */ (rows[4].querySelector('input'));
    expect(alreadyBox.checked).toBe(false);
    expect(rows[4].textContent).toContain('bereits importiert');
    expect(rows[0].textContent).toContain('01.12.2026 19:00');
    expect(
      view.getByText('Diese Termine werden öffentlich sichtbar (Kalender, Entdecken).')
    ).toBeTruthy();
    const publish = view.getByRole('button', { name: '3 Termine öffentlich veröffentlichen' });
    await fireEvent.click(publish);
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    await fireEvent.click(alreadyBox);
    expect([...props.onUpdate.mock.calls[0][0].selected].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('says so when nothing usable was found', () => {
    const { view } = renderCard({
      events: [ev('row-0', { dTag: undefined, problem: 'title' })],
      selected: new Set()
    });
    expect(view.getByText('Darin habe ich keine Termine erkannt.')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('done with a failure: retry plus the calendar link', async () => {
    const { view, props } = renderCard({
      events: EVENTS,
      selected: new Set(['a', 'b']),
      status: 'done',
      done: 2,
      result: { ok: ['a'], failed: [{ key: 'b', error: 'publish_failed' }] }
    });
    expect(view.getByText('1 von 2 veröffentlicht')).toBeTruthy();
    await fireEvent.click(view.getByRole('button', { name: 'Fehlgeschlagene erneut versuchen' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(view.getByRole('link', { name: 'Im Kalender ansehen' }).getAttribute('href')).toBe(
      '/calendar'
    );
  });
});
