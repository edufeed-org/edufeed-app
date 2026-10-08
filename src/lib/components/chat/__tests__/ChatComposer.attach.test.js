/**
 * The composer's file-attach affordance is opt-in, like the "+" apps button:
 * only surfaces that can upload pass `onAttachFiles`. Once they do, files
 * arrive three ways — the 📎 picker (multi-select), a paste whose clipboard
 * carries files, and a drop onto the composer pill — and all three land in
 * the same callback (issue "allow clipboard pastes to upload images").
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

import ChatComposer from '../ChatComposer.svelte';

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/stores/mention-candidates.svelte.js', () => ({
  useMentionCandidates: () => () => []
}));

const baseProps = {
  value: '',
  placeholder: 'write…',
  onSubmit: () => {}
};

const png = () => new File(['x'], 'image.png', { type: 'image/png' });

/** @param {HTMLElement} target @param {File[]} files */
async function paste(target, files) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { files, getData: () => '' }
  });
  target.dispatchEvent(event);
  await tick();
  return event;
}

/** @param {HTMLElement} target @param {string} type @param {File[]} files */
async function drag(target, type, files) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  target.dispatchEvent(event);
  await tick();
  return event;
}

describe('ChatComposer attach', () => {
  it('renders no attach button when onAttachFiles is not provided', () => {
    const { container } = render(ChatComposer, { props: { ...baseProps } });
    expect(container.querySelector('[data-testid="chat-attach-button"]')).toBeFalsy();
  });

  it('forwards every picked file to onAttachFiles and resets the input', async () => {
    const onAttachFiles = vi.fn();
    const { container } = render(ChatComposer, { props: { ...baseProps, onAttachFiles } });
    expect(container.querySelector('[data-testid="chat-attach-button"]')).toBeTruthy();

    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="chat-attach-input"]')
    );
    expect(input.multiple).toBe(true);
    const a = new File(['x'], 'worksheet.pdf', { type: 'application/pdf' });
    const b = png();
    Object.defineProperty(input, 'files', { value: [a, b], configurable: true });
    await fireEvent.change(input);

    expect(onAttachFiles).toHaveBeenCalledWith([a, b]);
    expect(input.value).toBe('');
  });

  it('disables the button and shows a spinner while uploading', () => {
    const { container } = render(ChatComposer, {
      props: { ...baseProps, onAttachFiles: () => {}, uploading: true }
    });
    const button = /** @type {HTMLButtonElement} */ (
      container.querySelector('[data-testid="chat-attach-button"]')
    );
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.loading')).toBeTruthy();
  });

  it('hands files pasted into the input to onAttachFiles', async () => {
    const onAttachFiles = vi.fn();
    const { getByTestId } = render(ChatComposer, {
      props: { ...baseProps, onAttachFiles, testid: 'chat-input' }
    });
    const file = png();
    await paste(getByTestId('chat-input'), [file]);
    expect(onAttachFiles).toHaveBeenCalledWith([file]);
  });

  it('ignores pasted files when the surface cannot upload', async () => {
    const { getByTestId } = render(ChatComposer, { props: { ...baseProps, testid: 'chat-input' } });
    const event = await paste(getByTestId('chat-input'), [png()]);
    // The text path still owns the paste (and inserts nothing for an empty clipboard).
    expect(event.defaultPrevented).toBe(true);
  });

  it('is a drop zone: the pill highlights during a file drag and a drop lands in onAttachFiles', async () => {
    const onAttachFiles = vi.fn();
    const { getByTestId } = render(ChatComposer, { props: { ...baseProps, onAttachFiles } });
    const form = getByTestId('chat-composer-form');
    await drag(form, 'dragenter', []);
    expect(form.dataset.dragging).toBe('true');
    const file = png();
    await drag(form, 'drop', [file]);
    expect(onAttachFiles).toHaveBeenCalledWith([file]);
    expect(form.dataset.dragging).toBeUndefined();
  });

  it('is not a drop zone without onAttachFiles', async () => {
    const { getByTestId } = render(ChatComposer, { props: { ...baseProps } });
    const form = getByTestId('chat-composer-form');
    await drag(form, 'dragenter', []);
    expect(form.dataset.dragging).toBeUndefined();
  });
});
