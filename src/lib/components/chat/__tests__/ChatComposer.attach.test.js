/**
 * The composer's file-attach affordance is opt-in, like the "+" apps button:
 * only surfaces that can upload (NIP-29 group chat) pass `onAttachFile`.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

import ChatComposer from '../ChatComposer.svelte';

const baseProps = {
  value: '',
  placeholder: 'write…',
  onSubmit: () => {}
};

describe('ChatComposer attach button', () => {
  it('renders no attach button when onAttachFile is not provided', () => {
    const { container } = render(ChatComposer, { props: { ...baseProps } });
    expect(container.querySelector('[data-testid="chat-attach-button"]')).toBeFalsy();
  });

  it('forwards the chosen file to onAttachFile and resets the input', async () => {
    const onAttachFile = vi.fn();
    const { container } = render(ChatComposer, { props: { ...baseProps, onAttachFile } });
    expect(container.querySelector('[data-testid="chat-attach-button"]')).toBeTruthy();

    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="chat-attach-input"]')
    );
    const file = new File(['x'], 'worksheet.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fireEvent.change(input);

    expect(onAttachFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('disables the button and shows a spinner while uploading', () => {
    const { container } = render(ChatComposer, {
      props: { ...baseProps, onAttachFile: () => {}, uploading: true }
    });
    const button = /** @type {HTMLButtonElement} */ (
      container.querySelector('[data-testid="chat-attach-button"]')
    );
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.loading')).toBeTruthy();
  });
});
