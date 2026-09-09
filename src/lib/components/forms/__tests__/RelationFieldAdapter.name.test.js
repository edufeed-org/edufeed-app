/** @vitest-environment jsdom */
/**
 * Name-only relation entries ("Erschienen in") — EKKW gap 2, UI half.
 * The container of a scholarly article (journal, Sammelband) is usually not
 * an event on our relays, so the adapter must accept a free-text name next to
 * the resource picker. Serializer/reverse mapping are covered in
 * forms.ekkw-outputs.test.js; this file pins the adapter contract.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RelationFieldAdapter from '$lib/components/forms/fields/RelationFieldAdapter.svelte';

vi.mock('$lib/components/educational/AMBResourceSearchInput.svelte', async () => {
  return { default: (await import('./RelationAdapterStub.svelte')).default };
});

/** @param {any} value @param {any} onchange */
function renderAdapter(value, onchange) {
  return render(RelationFieldAdapter, {
    field: { id: 'container', label: 'Erschienen in', output: 'amb:isPartOf', options: {} },
    value,
    error: null,
    readonly: false,
    onchange
  });
}

describe('RelationFieldAdapter free-text container names', () => {
  it('typing a name and pressing Enter emits a {name} entry', async () => {
    const onchange = vi.fn();
    const { container } = renderAdapter([], onchange);
    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="relation-name-input"]')
    );
    expect(input).toBeTruthy();

    await fireEvent.input(input, { target: { value: 'Zeitschrift für Pädagogik' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).toHaveBeenCalledWith([{ name: 'Zeitschrift für Pädagogik' }]);
    expect(input.value).toBe('');
  });

  it('losing focus commits the typed name too (no silent loss)', async () => {
    const onchange = vi.fn();
    const { container } = renderAdapter([], onchange);
    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="relation-name-input"]')
    );

    await fireEvent.input(input, { target: { value: 'Sammelband Religionspädagogik' } });
    await fireEvent.blur(input);

    expect(onchange).toHaveBeenCalledWith([{ name: 'Sammelband Religionspädagogik' }]);
  });

  it('name entries render as text chips and can be removed', async () => {
    const onchange = vi.fn();
    renderAdapter(
      [{ coordinate: '30142:abc:res1', relayHint: '' }, { name: 'Zeitschrift X' }],
      onchange
    );

    expect(screen.getByText('Zeitschrift X')).toBeTruthy();
    const removeButtons = screen.getAllByLabelText('Remove');
    expect(removeButtons).toHaveLength(2);

    await fireEvent.click(removeButtons[1]);
    expect(onchange).toHaveBeenCalledWith([{ coordinate: '30142:abc:res1', relayHint: '' }]);
  });

  it('controls: whitespace-only commits nothing; duplicate names are not re-added', async () => {
    const onchange = vi.fn();
    const { container } = renderAdapter([{ name: 'Zeitschrift X' }], onchange);
    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="relation-name-input"]')
    );

    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.input(input, { target: { value: 'Zeitschrift X' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onchange).not.toHaveBeenCalled();
  });
});
