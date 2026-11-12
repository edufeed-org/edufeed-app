/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import WerkbankRail from '../assistant/werkbank/WerkbankRail.svelte';
import { railRows } from '$lib/termi/werkbank.js';

const parts = [{ key: 'lesson-1', kind: 'lesson', n: 1, title: 'Brüche', text: 'x', turnId: 't1' }];
const rows = railRows({ phase: 3, plan: [{ n: 1 }, { n: 2 }] }, parts, { writingKey: 'lesson-2' });

describe('WerkbankRail', () => {
  it('renders the 4 steps and one row per part', () => {
    const view = render(WerkbankRail, { props: { rows, selected: null, onselect: vi.fn() } });
    expect(view.getAllByTestId('werkbank-step')).toHaveLength(4);
    expect(view.getAllByTestId('werkbank-part')).toHaveLength(3);
  });

  it('a todo step is disabled; a done step selects itself', async () => {
    const onselect = vi.fn();
    const view = render(WerkbankRail, { props: { rows, selected: null, onselect } });
    const steps = view.getAllByTestId('werkbank-step');
    expect(steps[3].dataset.state).toBe('todo');
    expect(/** @type {HTMLButtonElement} */ (steps[3]).disabled).toBe(true);
    await fireEvent.click(steps[0]);
    expect(onselect).toHaveBeenCalledWith({ type: 'step', n: 1 });
  });

  it('a writing part row says so; planned parts get a localised title; the selection is aria-current', async () => {
    const onselect = vi.fn();
    const view = render(WerkbankRail, {
      props: { rows, selected: { type: 'part', key: 'lesson-1' }, onselect }
    });
    const [overview, first, second] = view.getAllByTestId('werkbank-part');
    expect(second.dataset.state).toBe('writing');
    expect(overview.textContent).toContain(m.termi_werkbank_part_overview());
    expect(second.textContent).toContain(m.termi_werkbank_part_lesson({ n: 2 }));
    expect(first.getAttribute('aria-current')).toBe('true');
    await fireEvent.click(second);
    expect(onselect).toHaveBeenCalledWith({ type: 'part', key: 'lesson-2' });
  });
});
