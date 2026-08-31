/**
 * showToast targeting — journey-test regression (2026-08-14): error toasts
 * from settings/modals never became visible. Two mechanisms:
 * - appending INSIDE a CSS modal (`.modal-open` div): DaisyUI's modal box
 *   transforms/overflow can clip the "fixed" toast entirely;
 * - container lookup via subtree querySelector: a stale container hidden
 *   inside a closed modal swallows every later body toast.
 * Contract now: toasts append to the top-layer <dialog open> when one is up
 * (body content stacks below the top layer regardless of z-index), else to
 * document.body — always as a DIRECT child of the target.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { showToast } from '$lib/helpers/toast.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('showToast targeting', () => {
  it('appends to document.body as a direct child by default', () => {
    showToast('hello', 'info', 0);
    const container = document.querySelector('.toast-container');
    expect(container?.parentElement).toBe(document.body);
    expect(container?.textContent).toContain('hello');
  });

  it('does NOT append inside a CSS modal (.modal-open div)', () => {
    const modal = document.createElement('div');
    modal.className = 'modal-open modal';
    document.body.appendChild(modal);
    showToast('err', 'error', 0);
    const container = document.querySelector('.toast-container');
    expect(container?.parentElement).toBe(document.body);
    expect(modal.querySelector('.toast-container')).toBeNull();
  });

  it('appends inside an OPEN native dialog (top layer would hide body toasts)', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    showToast('in dialog', 'info', 0);
    const container = dialog.querySelector('.toast-container');
    expect(container).not.toBeNull();
    expect(container?.parentElement).toBe(dialog);
  });

  it('ignores a stale container hidden deeper in the tree and creates its own', () => {
    const hiddenHost = document.createElement('div');
    const stale = document.createElement('div');
    stale.className = 'toast-container';
    hiddenHost.appendChild(stale);
    document.body.appendChild(hiddenHost);

    showToast('visible', 'info', 0);
    expect(stale.textContent).not.toContain('visible');
    const containers = document.querySelectorAll('.toast-container');
    expect(containers.length).toBe(2);
    const fresh = [...containers].find((c) => c !== stale);
    expect(fresh?.parentElement).toBe(document.body);
    expect(fresh?.textContent).toContain('visible');
  });
});
