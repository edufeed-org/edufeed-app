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
    onRetry: vi.fn(),
    onStop: vi.fn(),
    onReextract: vi.fn()
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
    const boxes = rows.map((r) => /** @type {HTMLInputElement} */ (r.querySelector('input')));
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

  it('the header checkbox toggles only tickable rows (no problem, not already imported)', async () => {
    const { view, props } = renderCard({
      events: EVENTS,
      selected: new Set(['a', 'b', 'c']),
      already: new Set(['d'])
    });
    const all = /** @type {HTMLInputElement} */ (view.getByTestId('termi-import-all'));
    expect(all.checked).toBe(true);
    await fireEvent.click(all);
    expect([...props.onUpdate.mock.calls[0][0].selected]).toEqual([]);

    const partial = renderCard({
      events: EVENTS,
      selected: new Set(['a', 'd']),
      already: new Set(['d'])
    });
    const all2 = /** @type {HTMLInputElement} */ (
      partial.view.getAllByTestId('termi-import-all').at(-1)
    );
    expect(all2.checked).toBe(false);
    await fireEvent.click(all2);
    expect([...partial.props.onUpdate.mock.calls[0][0].selected].sort()).toEqual([
      'a',
      'b',
      'c',
      'd'
    ]);
  });

  it('dates: end time, all-day, multi-day all-day', () => {
    const { view } = renderCard({
      events: [
        ev('t', { endTime: '21:00' }),
        ev('ad', { allDay: true, startTime: undefined }),
        ev('md', { allDay: true, startTime: undefined, endDate: '2026-12-03' })
      ],
      selected: new Set()
    });
    const rows = view.getAllByTestId('termi-import-row').map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('01.12.2026 19:00–21:00');
    expect(rows[1]).toContain('01.12.2026');
    expect(rows[1]).not.toContain('–');
    expect(rows[2]).toContain('01.12.2026–03.12.2026');
  });

  it('the descriptions checkbox starts off', () => {
    const { view } = renderCard({
      events: [ev('a', { description: 'Mehr Infos' })],
      selected: new Set(['a'])
    });
    const box = /** @type {HTMLInputElement} */ (
      view.getByRole('checkbox', { name: 'Beschreibungen übernehmen' })
    );
    expect(box.checked).toBe(false);
    expect(view.queryByTestId('termi-import-description')).toBeNull();
  });

  it('descriptions ticked: each row shows its description as clamped text', () => {
    const { view } = renderCard({
      events: [ev('a', { description: 'Mehr Infos https://x.example' }), ev('b')],
      selected: new Set(['a', 'b']),
      withDescriptions: true
    });
    const desc = view.getAllByTestId('termi-import-description');
    expect(desc).toHaveLength(1);
    expect(desc[0].textContent?.trim()).toBe('Mehr Infos https://x.example');
    expect(desc[0].className).toContain('line-clamp-2');
    expect(desc[0].querySelector('a')).toBeNull();
  });

  it('nothing usable but truncated: the truncation note stays', () => {
    const { view } = renderCard({ events: [], selected: new Set(), truncated: true });
    expect(view.getByText('Darin habe ich keine Termine erkannt.')).toBeTruthy();
    expect(view.getByText('Nur die ersten 60.000 Zeichen wurden gesendet.')).toBeTruthy();
  });

  it('says so when nothing usable was found, and offers to run the recognition again', async () => {
    const { view, props } = renderCard({
      events: [ev('row-0', { dTag: undefined, problem: 'title' })],
      selected: new Set()
    });
    expect(view.getByText('Darin habe ich keine Termine erkannt.')).toBeTruthy();
    expect(view.queryByText(/ohne gültiges Datum/)).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'Erneut versuchen' }));
    expect(props.onReextract).toHaveBeenCalledTimes(1);
  });

  it('nothing usable because of dates: names the count', () => {
    const { view } = renderCard({
      events: [ev('row-0', { problem: 'date' }), ev('row-1', { problem: 'date' })],
      selected: new Set()
    });
    expect(view.getByText('2 Zeilen ohne gültiges Datum')).toBeTruthy();
  });

  it('publishing: "Stopp" calls onStop', async () => {
    const { view, props } = renderCard({
      events: EVENTS,
      selected: new Set(['a', 'b']),
      status: 'publishing',
      done: 1
    });
    await fireEvent.click(view.getByRole('button', { name: 'Stopp' }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it('done after a stop: skipped rows count as open and are retried', () => {
    const { view } = renderCard({
      events: EVENTS,
      selected: new Set(['a', 'b', 'c']),
      status: 'done',
      result: { ok: ['a'], failed: [], skipped: ['b', 'c'] }
    });
    expect(view.getByText('1 von 3 veröffentlicht')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Fehlgeschlagene erneut versuchen' })).toBeTruthy();
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
