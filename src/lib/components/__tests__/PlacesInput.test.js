/**
 * PlacesInput — multi-entry place picker with geocoding autocomplete.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import PlacesInput from '../shared/PlacesInput.svelte';

vi.mock('$lib/helpers/geocoding.js', () => ({
  autocompleteAddress: vi.fn(async (/** @type {string} */ q) =>
    q.startsWith('Köln') ? [{ formatted: 'Köln, Deutschland', lat: 50.94, lng: 6.96 }] : []
  )
}));

/** @param {HTMLElement} container @param {string} text */
async function typeQuery(container, text) {
  const input = /** @type {Element} */ (container.querySelector('[data-testid="places-input"]'));
  await fireEvent.input(input, { target: { value: text } });
  // debounce (400ms) → wait for the suggestion button to appear
  return input;
}

describe('PlacesInput', () => {
  it('adds a suggested place with coordinates and renders a chip', async () => {
    const onchange = vi.fn();
    const { container } = render(PlacesInput, { props: { places: [], onchange } });

    await typeQuery(container, 'Köln');
    await waitFor(
      () => {
        expect(container.textContent).toContain('Köln, Deutschland');
      },
      { timeout: 2000 }
    );

    const suggestion = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Köln, Deutschland')
    );
    await fireEvent.click(/** @type {Element} */ (suggestion));

    expect(onchange).toHaveBeenCalledWith([{ name: 'Köln, Deutschland', lat: 50.94, lng: 6.96 }]);
    expect(container.querySelector('[data-testid="places-chips"]')?.textContent).toContain(
      'Köln, Deutschland'
    );
  });

  it('adds free text as name-only place on Enter', async () => {
    const onchange = vi.fn();
    const { container } = render(PlacesInput, { props: { places: [], onchange } });

    const input = await typeQuery(container, 'Xy');
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).toHaveBeenCalledWith([{ name: 'Xy' }]);
  });

  it('removes a place via the chip close button', async () => {
    const onchange = vi.fn();
    const { container } = render(PlacesInput, {
      props: { places: [{ name: 'Bonn' }], onchange }
    });

    const remove = container.querySelector('[data-testid="places-chips"] button');
    await fireEvent.click(/** @type {Element} */ (remove));

    expect(onchange).toHaveBeenCalledWith([]);
  });

  it('does not add duplicates', async () => {
    const onchange = vi.fn();
    const { container } = render(PlacesInput, {
      props: { places: [{ name: 'Xy' }], onchange }
    });

    const input = await typeQuery(container, 'Xy');
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).not.toHaveBeenCalled();
  });
});
