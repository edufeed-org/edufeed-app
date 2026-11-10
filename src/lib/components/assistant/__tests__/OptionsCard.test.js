/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import OptionsCard from '../cards/OptionsCard.svelte';

overwriteGetLocale(() => 'de');

const card = (
  multi = false,
  options = [
    { id: 'a', label: 'Brüche deuten', hint: 'Teil eines Ganzen' },
    { id: 'b', label: 'Brüche vergleichen' }
  ]
) => ({ question: 'Welche Kompetenzen?', options, multi });

describe('OptionsCard', () => {
  it('single: clicking an option sends its label', async () => {
    const onSend = vi.fn();
    const { getAllByTestId, getByText } = render(OptionsCard, { card: card(), onSend });
    expect(getByText('Teil eines Ganzen')).toBeTruthy();
    await fireEvent.click(getAllByTestId('termi-option')[1]);
    expect(onSend).toHaveBeenCalledWith('Brüche vergleichen');
  });

  it('multi: ticking two and Übernehmen sends "Auswahl: a; b"', async () => {
    const onSend = vi.fn();
    const { getAllByRole, getByTestId } = render(OptionsCard, { card: card(true), onSend });
    const apply = /** @type {HTMLButtonElement} */ (getByTestId('termi-options-apply'));
    expect(apply.textContent?.trim()).toBe('Übernehmen');
    expect(apply.disabled).toBe(true);
    for (const box of getAllByRole('checkbox')) await fireEvent.click(box);
    expect(apply.disabled).toBe(false);
    await fireEvent.click(apply);
    expect(onSend).toHaveBeenCalledWith('Auswahl: Brüche deuten; Brüche vergleichen');
  });

  it('duplicate ids never reach the keyed each (deduped upstream, still rendered once)', () => {
    const dup = card(false, [
      { id: 'a', label: 'Eins' },
      { id: 'a', label: 'Eins nochmal' },
      { id: 'b', label: 'Zwei' }
    ]);
    const { getAllByTestId } = render(OptionsCard, { card: dup, onSend: vi.fn() });
    expect(getAllByTestId('termi-option').map((b) => b.textContent?.trim())).toEqual([
      'Eins',
      'Zwei'
    ]);
  });

  it('without onSend the card is inert', async () => {
    const { getAllByTestId, getByTestId, getAllByRole } = render(OptionsCard, { card: card(true) });
    expect(getByTestId('termi-options').dataset.inert).toBe('true');
    expect(
      getAllByRole('checkbox').every((b) => /** @type {HTMLInputElement} */ (b).disabled)
    ).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (getByTestId('termi-options-apply')).disabled).toBe(
      true
    );
    const single = render(OptionsCard, { card: card() });
    const buttons = single.container.querySelectorAll('button[data-testid="termi-option"]');
    expect(buttons).toHaveLength(2);
    expect([...buttons].every((b) => /** @type {HTMLButtonElement} */ (b).disabled)).toBe(true);
    expect(getAllByTestId('termi-option').length).toBeGreaterThan(0);
  });
});
