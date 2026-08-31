/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FieldsRenderer from '$lib/components/forms/FieldsRenderer.svelte';

describe('field-type registry', () => {
  it('renders registered date type via DateField (German placeholder mask)', () => {
    const field = { id: 'when', type: 'date', label: 'Datum', options: {} };
    render(FieldsRenderer, { fields: [field], values: {}, errors: {}, onchange: vi.fn() });
    expect(screen.getByPlaceholderText('TT.MM.JJJJ')).toBeTruthy();
  });

  it('falls back to a text input for unknown renderElement types', async () => {
    const field = { id: 'mystery', type: 'holo-picker-9000', label: 'Mystery', options: {} };
    const onchange = vi.fn();
    render(FieldsRenderer, { fields: [field], values: {}, errors: {}, onchange });
    const input = screen.getByLabelText('Mystery');
    expect(input.getAttribute('type')).toBe('text');
    await fireEvent.input(input, { target: { value: 'hello' } });
    expect(onchange).toHaveBeenCalledWith('mystery', 'hello');
  });
});
