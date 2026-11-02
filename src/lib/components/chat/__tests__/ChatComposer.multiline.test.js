/**
 * The channel composer is a growing multiline field, like the DM composer
 * (issue dfc435d5: "Multiline editing for chat messages is not functional").
 * Enter sends, Shift+Enter inserts a newline, and the field grows with the
 * text instead of hiding it behind a one-line box whose line-height was the
 * whole field height.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

import ChatComposer from '../ChatComposer.svelte';

function setup(props = {}) {
  const utils = render(ChatComposer, {
    props: {
      value: 'hello',
      placeholder: 'write…',
      onSubmit: () => {},
      testid: 'chat-input',
      ...props
    }
  });
  const field = /** @type {HTMLElement} */ (utils.getByTestId('chat-input'));
  const form = /** @type {HTMLElement} */ (utils.getByTestId('chat-composer-form'));
  return { ...utils, field, form };
}

describe('ChatComposer multiline', () => {
  it('renders the field in multiline mode without the fixed-height input styling', () => {
    const { field } = setup();
    expect(field.getAttribute('aria-multiline')).toBe('true');
    expect(field.classList.contains('single-line')).toBe(false);
    expect(field.classList.contains('whitespace-nowrap')).toBe(false);
    // DaisyUI's `input` pins height to --size and the previous
    // `leading-(--size)` put a whole field height between two lines.
    expect(field.classList.contains('input')).toBe(false);
    expect(field.classList.contains('leading-(--size)')).toBe(false);
    expect(field.classList.contains('w-full')).toBe(true);
    // caps the growth and scrolls beyond it (ComposerInput's chat default)
    expect(field.classList.contains('max-h-40')).toBe(true);
    expect(field.classList.contains('overflow-y-auto')).toBe(true);
  });

  it('keeps the soft keyboard’s Enter key labelled "send"', () => {
    const { field } = setup();
    expect(field.getAttribute('enterkeyhint')).toBe('send');
  });

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const onSubmit = vi.fn();
    const { field } = setup({ onSubmit });
    await fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('aligns the buttons with the last line and rounds the pill so a tall field is not a capsule', () => {
    const { form } = setup();
    expect(form.classList.contains('items-end')).toBe(true);
    expect(form.classList.contains('items-center')).toBe(false);
    expect(form.classList.contains('rounded-full')).toBe(false);
  });
});
