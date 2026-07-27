/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { composerKeydown } from '$lib/cordn/composer.js';

function makeTextarea(value = 'hallo', cursor = value.length) {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.selectionStart = textarea.selectionEnd = cursor;
  document.body.appendChild(textarea);
  return textarea;
}

/** @param {Partial<KeyboardEvent>} init @param {HTMLTextAreaElement} target */
function keydown(target, init) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('composerKeydown', () => {
  it('plain Enter submits and prevents the newline', () => {
    const textarea = makeTextarea();
    const submit = vi.fn();
    const event = keydown(textarea, {});
    composerKeydown(event, submit);
    expect(submit).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Shift+Enter does not submit (native newline)', () => {
    const textarea = makeTextarea();
    const submit = vi.fn();
    const event = keydown(textarea, { shiftKey: true });
    composerKeydown(event, submit);
    expect(submit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Alt+Enter inserts a newline at the cursor and does not submit', () => {
    const textarea = makeTextarea('ab', 1);
    const submit = vi.fn();
    const inputListener = vi.fn();
    textarea.addEventListener('input', inputListener);
    const event = keydown(textarea, { altKey: true });
    composerKeydown(event, submit);
    expect(submit).not.toHaveBeenCalled();
    expect(textarea.value).toBe('a\nb');
    expect(textarea.selectionStart).toBe(2);
    expect(inputListener).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores non-Enter keys and IME composition', () => {
    const textarea = makeTextarea();
    const submit = vi.fn();
    composerKeydown(keydown(textarea, { key: 'a' }), submit);
    composerKeydown(keydown(textarea, { isComposing: true }), submit);
    expect(submit).not.toHaveBeenCalled();
  });
});
