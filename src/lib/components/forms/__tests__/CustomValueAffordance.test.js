/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CustomValueAffordance from '../CustomValueAffordance.svelte';

describe('CustomValueAffordance', () => {
  it('renders the button when value is empty', () => {
    render(CustomValueAffordance, {
      value: '',
      label: 'Custom',
      buttonLabel: '+ custom',
      placeholder: 'enter…',
      onchange: () => {}
    });
    expect(screen.getByRole('button', { name: '+ custom' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders the input when value is non-empty', () => {
    render(CustomValueAffordance, {
      value: 'monatlich',
      label: 'Custom',
      buttonLabel: '+ custom',
      placeholder: 'enter…',
      onchange: () => {}
    });
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('monatlich');
  });

  it('clicking the button reveals the input', async () => {
    render(CustomValueAffordance, {
      value: '',
      label: 'Custom',
      buttonLabel: '+ custom',
      placeholder: 'enter…',
      onchange: () => {}
    });
    await fireEvent.click(screen.getByRole('button', { name: '+ custom' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('typing in the input calls onchange with the new value', async () => {
    const onchange = vi.fn();
    render(CustomValueAffordance, {
      value: 'a',
      label: 'Custom',
      buttonLabel: '+ custom',
      placeholder: 'enter…',
      onchange
    });
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'abc' } });
    expect(onchange).toHaveBeenCalledWith('abc');
  });

  it('the clear control empties the value and collapses to the button', async () => {
    const onchange = vi.fn();
    const { rerender } = render(CustomValueAffordance, {
      value: 'something',
      label: 'Custom',
      buttonLabel: '+ custom',
      placeholder: 'enter…',
      onchange
    });
    await fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onchange).toHaveBeenCalledWith('');
    // Simulate the parent re-rendering with the new (empty) value:
    await rerender({
      value: '',
      label: 'Custom',
      buttonLabel: '+ custom',
      placeholder: 'enter…',
      onchange
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ custom' })).toBeInTheDocument();
  });

  it('is disabled (no toggling, no typing) when readonly', () => {
    render(CustomValueAffordance, {
      value: 'monatlich',
      label: 'Custom',
      buttonLabel: '+ custom',
      placeholder: 'enter…',
      readonly: true,
      onchange: () => {}
    });
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
});
