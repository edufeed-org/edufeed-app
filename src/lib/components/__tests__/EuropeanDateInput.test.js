// @ts-nocheck
/**
 * EuropeanDateInput — regression tests for silent date loss (dates reported
 * missing from drafts / after step switches / when editing). The field used
 * to accept only strict DD.MM.YYYY: anything else (2-digit year, pasted ISO)
 * stayed visible in the field but bound '' — saved drafts lost the date and
 * a remount cleared the text with no feedback.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import Host from './fixtures/EuropeanDateInputHost.svelte';

// Cally registers real custom elements on import (client-only); irrelevant here.
vi.mock('cally', () => ({}));

function setup(initial = '') {
  let bound = initial;
  const utils = render(Host, { props: { initial, onValue: (v) => (bound = v) } });
  const input = utils.container.querySelector('#test-date');
  return { ...utils, input, bound: () => bound };
}

describe('EuropeanDateInput', () => {
  it('binds ISO for strict German input', async () => {
    const { input, bound } = setup();
    await fireEvent.input(input, { target: { value: '15.03.2024' } });
    expect(bound()).toBe('2024-03-15');
  });

  it('binds ISO for 2-digit-year input instead of silently dropping it', async () => {
    const { input, bound } = setup();
    await fireEvent.input(input, { target: { value: '15.03.24' } });
    expect(bound()).toBe('2024-03-15');
  });

  it('binds pasted ISO input', async () => {
    const { input, bound } = setup();
    await fireEvent.input(input, { target: { value: '2024-01-05' } });
    expect(bound()).toBe('2024-01-05');
  });

  it('normalizes lenient input to DD.MM.YYYY on blur', async () => {
    const { input } = setup();
    await fireEvent.input(input, { target: { value: '15.3.24' } });
    await fireEvent.blur(input);
    expect(input.value).toBe('15.03.2024');
  });

  it('flags unparseable text on blur instead of losing it silently', async () => {
    const { input, container, bound } = setup();
    await fireEvent.input(input, { target: { value: 'irgendwann 2024' } });
    await fireEvent.blur(input);
    expect(bound()).toBe('');
    expect(container.querySelector('[data-testid="date-input-invalid"]')).not.toBeNull();
    expect(input.classList.contains('input-error')).toBe(true);
    // typing a valid date clears the flag
    await fireEvent.input(input, { target: { value: '01.02.2023' } });
    expect(bound()).toBe('2023-02-01');
    expect(container.querySelector('[data-testid="date-input-invalid"]')).toBeNull();
  });

  it('does not flag an emptied field', async () => {
    const { input, container } = setup();
    await fireEvent.input(input, { target: { value: 'abc' } });
    await fireEvent.input(input, { target: { value: '' } });
    await fireEvent.blur(input);
    expect(container.querySelector('[data-testid="date-input-invalid"]')).toBeNull();
  });

  it('reflects external value changes (edit-mode prefill) into the field', async () => {
    const { input, component } = setup();
    component.setValue('2023-02-01');
    await tick();
    expect(input.value).toBe('01.02.2023');
  });

  it('seeds the field from an initial value', () => {
    const { input } = setup('2026-06-19');
    expect(input.value).toBe('19.06.2026');
  });
});
