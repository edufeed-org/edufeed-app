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
import * as m from '$lib/paraglide/messages';

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

// Issue "Time picker would be nice in addition to the date picker": a clock
// button opens a listbox of 15-minute slots next to the (unchanged) text field.
describe('EuropeanTimeInput — time picker', () => {
  function openButton(utils) {
    return utils.getByRole('button', { name: m.time_picker_open() });
  }

  it('offers a closed clock button for the picker', () => {
    const utils = setup('14:30');
    const button = openButton(utils);
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(utils.queryByRole('listbox')).toBeNull();
  });

  it('opens a focused listbox of 24h quarter-hour slots', async () => {
    const utils = setup('14:30');
    await fireEvent.click(openButton(utils));
    const listbox = utils.getByRole('listbox', { name: m.time_picker_options_label() });
    const options = utils.getAllByRole('option');
    expect(options).toHaveLength(96);
    expect(options[0].textContent.trim()).toBe('00:00');
    expect(options[95].textContent.trim()).toBe('23:45');
    expect(openButton(utils).getAttribute('aria-expanded')).toBe('true');
    expect(openButton(utils).getAttribute('aria-controls')).toBe(listbox.id);
    expect(document.activeElement).toBe(listbox);
  });

  it('marks the current value as selected and active', async () => {
    const utils = setup('14:30');
    await fireEvent.click(openButton(utils));
    const listbox = utils.getByRole('listbox');
    const selected = utils.getByRole('option', { selected: true });
    expect(selected.textContent.trim()).toBe('14:30');
    expect(listbox.getAttribute('aria-activedescendant')).toBe(selected.id);
  });

  it('starts at the nearest slot for an off-grid value', async () => {
    const utils = setup('14:37');
    await fireEvent.click(openButton(utils));
    const listbox = utils.getByRole('listbox');
    expect(utils.queryByRole('option', { selected: true })).toBeNull();
    const active = document.getElementById(listbox.getAttribute('aria-activedescendant'));
    expect(active.textContent.trim()).toBe('14:30');
  });

  it('selects a clicked slot and closes', async () => {
    const utils = setup('14:30');
    await fireEvent.click(openButton(utils));
    await fireEvent.click(utils.getByRole('option', { name: '16:15' }));
    expect(utils.bound()).toBe('16:15');
    expect(utils.input.value).toBe('16:15');
    expect(utils.queryByRole('listbox')).toBeNull();
  });

  it('moves with the arrow keys and selects with Enter', async () => {
    const utils = setup('14:30');
    await fireEvent.click(openButton(utils));
    const listbox = utils.getByRole('listbox');
    await fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    const active = document.getElementById(listbox.getAttribute('aria-activedescendant'));
    expect(active.textContent.trim()).toBe('14:45');
    await fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(utils.bound()).toBe('14:45');
    expect(utils.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(openButton(utils));
  });

  it('closes on Escape without changing the value', async () => {
    const utils = setup('14:30');
    await fireEvent.click(openButton(utils));
    const listbox = utils.getByRole('listbox');
    await fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await fireEvent.keyDown(listbox, { key: 'Escape' });
    expect(utils.queryByRole('listbox')).toBeNull();
    expect(utils.bound()).toBe('14:30');
    expect(document.activeElement).toBe(openButton(utils));
  });

  it('closes on a click outside', async () => {
    const utils = setup('14:30');
    await fireEvent.click(openButton(utils));
    await fireEvent.click(document.body);
    expect(utils.queryByRole('listbox')).toBeNull();
  });
});
