/**
 * showToast `action` / `dismissLabel` options — the "new version available"
 * toast needs a button that runs a callback (reload) and, being persistent,
 * a way to close it without acting.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToast } from '$lib/helpers/toast.js';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('showToast action button', () => {
  it('renders a DaisyUI button with the label and runs onClick, then dismisses', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    showToast('update?', 'info', 0, { action: { label: 'Reload', onClick } });

    const button = /** @type {HTMLButtonElement} */ (
      document.querySelector('.toast-container button.btn')
    );
    expect(button).not.toBeNull();
    expect(button.textContent).toBe('Reload');
    expect(button.type).toBe('button');

    button.click();
    expect(onClick).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(document.querySelector('.toast-container')).toBeNull();
  });

  it('renders no button without an action', () => {
    showToast('plain', 'info', 0);
    expect(document.querySelector('.toast-container button')).toBeNull();
  });

  it('adds a close button with dismissLabel, which removes the toast without acting', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    showToast('update?', 'info', 0, {
      action: { label: 'Reload', onClick },
      dismissLabel: 'Close'
    });

    const close = /** @type {HTMLButtonElement} */ (
      document.querySelector('.toast-container button[aria-label="Close"]')
    );
    expect(close).not.toBeNull();
    expect(close.textContent).toBe('✕');
    close.click();
    vi.runAllTimers();
    expect(onClick).not.toHaveBeenCalled();
    expect(document.querySelector('.toast-container')).toBeNull();
  });
});
