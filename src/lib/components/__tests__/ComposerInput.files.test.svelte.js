// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * ComposerInput file intake (issue "allow clipboard pastes to upload images
 * and stuff from clipboard"): a paste whose clipboard carries files hands
 * them to the host's `onFiles` instead of inserting text; plain-text pastes
 * are untouched, and a host without `onFiles` keeps the text-only behaviour.
 * Drops are the host's job (`fileDropZone`, file-drop.test.js).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import ComposerInputHost from './fixtures/ComposerInputHost.svelte';

vi.mock('$lib/stores/profile-map.svelte.js', () => import('./fixtures/profile-map-mock.svelte.js'));
vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);

function setup(props = {}) {
  const utils = render(ComposerInputHost, { props });
  const editor = utils.getByTestId('emoji-input');
  const value = () => utils.getByTestId('value').textContent;
  return { ...utils, editor, value };
}

/** A paste event carrying `files` and/or plain text, the way browsers build it. */
function pasteEvent({ files = [], text = '' } = {}) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
      getData: (type) => (type === 'text/plain' ? text : '')
    }
  });
  return event;
}

const png = () => new File(['png-bytes'], 'image.png', { type: 'image/png' });

describe('ComposerInput onFiles', () => {
  it('hands pasted files to onFiles and inserts no text', async () => {
    const onFiles = vi.fn();
    const { editor, value } = setup({ onFiles, initial: 'hello' });
    const file = png();
    const event = pasteEvent({ files: [file], text: 'image.png' });
    editor.dispatchEvent(event);
    await tick();
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toEqual([file]);
    expect(event.defaultPrevented).toBe(true);
    expect(value()).toBe('hello');
  });

  it('passes every pasted file, in clipboard order', async () => {
    const onFiles = vi.fn();
    const { editor } = setup({ onFiles });
    const a = png();
    const b = new File(['pdf'], 'sheet.pdf', { type: 'application/pdf' });
    editor.dispatchEvent(pasteEvent({ files: [a, b] }));
    await tick();
    expect(onFiles.mock.calls[0][0]).toEqual([a, b]);
  });

  it('keeps plain-text pastes on the text path', async () => {
    const onFiles = vi.fn();
    const { editor, value } = setup({ onFiles });
    editor.focus();
    editor.dispatchEvent(pasteEvent({ text: 'pasted words' }));
    await tick();
    expect(onFiles).not.toHaveBeenCalled();
    expect(value()).toBe('pasted words');
  });

  it('ignores files when the host has no onFiles', async () => {
    const { editor, value } = setup({ initial: 'x' });
    const event = pasteEvent({ files: [png()], text: '' });
    editor.dispatchEvent(event);
    await tick();
    expect(value()).toBe('x');
  });
});
