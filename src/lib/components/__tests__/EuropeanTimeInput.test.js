// @ts-nocheck
/**
 * EuropeanTimeInput — 24-hour HH:MM text input replacing native
 * `<input type="time">` (which shows a locale-dependent 12-hour clock,
 * issue #33). Mirrors the EuropeanDateInput behavior: lenient typing
 * binds eagerly, normalization and invalid-flagging happen on blur.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import Host from './fixtures/EuropeanTimeInputHost.svelte';

function setup(initial = '') {
  let bound = initial;
  const utils = render(Host, { props: { initial, onValue: (v) => (bound = v) } });
  const input = utils.container.querySelector('#test-time');
  return { ...utils, input, bound: () => bound };
}

describe('EuropeanTimeInput', () => {
  it('binds HH:MM for 24-hour input', async () => {
    const { input, bound } = setup();
    await fireEvent.input(input, { target: { value: '13:30' } });
    expect(bound()).toBe('13:30');
  });

  it('binds zero-padded HH:MM for lenient input', async () => {
    const { input, bound } = setup();
    await fireEvent.input(input, { target: { value: '9.30' } });
    expect(bound()).toBe('09:30');
  });

  it('normalizes lenient input to HH:MM on blur', async () => {
    const { input } = setup();
    await fireEvent.input(input, { target: { value: '930' } });
    await fireEvent.blur(input);
    expect(input.value).toBe('09:30');
  });

  it('flags unparseable text on blur instead of losing it silently', async () => {
    const { input, container, bound } = setup();
    await fireEvent.input(input, { target: { value: '1 PM' } });
    await fireEvent.blur(input);
    expect(bound()).toBe('');
    expect(container.querySelector('[data-testid="time-input-invalid"]')).not.toBeNull();
    expect(input.classList.contains('input-error')).toBe(true);
    // typing a valid time clears the flag
    await fireEvent.input(input, { target: { value: '13:00' } });
    expect(bound()).toBe('13:00');
    expect(container.querySelector('[data-testid="time-input-invalid"]')).toBeNull();
  });

  it('does not flag an emptied field', async () => {
    const { input, container } = setup();
    await fireEvent.input(input, { target: { value: 'abc' } });
    await fireEvent.input(input, { target: { value: '' } });
    await fireEvent.blur(input);
    expect(container.querySelector('[data-testid="time-input-invalid"]')).toBeNull();
  });

  it('reflects external value changes (edit-mode prefill) into the field', async () => {
    const { input, component } = setup();
    component.setValue('14:45');
    await tick();
    expect(input.value).toBe('14:45');
  });

  it('seeds the field from an initial value', () => {
    const { input } = setup('09:00');
    expect(input.value).toBe('09:00');
  });
});
