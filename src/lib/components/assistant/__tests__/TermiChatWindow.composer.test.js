/** @vitest-environment jsdom */
// Multiline composer: Enter sends, Shift+Enter breaks the line, IME
// composition never triggers a send, and the textarea grows with content
// up to a five-line cap.
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

termiEnv.config.termi = { enabled: false, embed: false, llm: false };
termiEnv.user = { pubkey: 'a'.repeat(64), type: 'nsec' };

vi.mock('$lib/services/blocked-authors.svelte.js', () => ({
  isBlockedAuthor: () => false,
  getBlockedAuthorsVersion: () => 0
}));

import TermiChatWindow from '../TermiChatWindow.svelte';

function renderWindow() {
  return render(TermiChatWindow, { props: windowProps() });
}

afterEach(() => vi.unstubAllGlobals());

describe('TermiChatWindow composer', () => {
  it('is a textarea', () => {
    const view = renderWindow();
    const el = view.getByTestId('termi-input');
    expect(el.tagName).toBe('TEXTAREA');
  });

  it('Enter sends, Shift+Enter inserts a newline', async () => {
    const view = renderWindow();
    const el = /** @type {HTMLTextAreaElement} */ (view.getByTestId('termi-input'));
    await fireEvent.input(el, { target: { value: 'hallo' } });

    const notPrevented = await fireEvent.keyDown(el, { key: 'Enter', shiftKey: true });
    expect(notPrevented).toBe(true); // not prevented: default newline behaviour stays
    expect(el.value).toBe('hallo'); // ask() was not called

    const prevented = await fireEvent.keyDown(el, { key: 'Enter' });
    expect(prevented).toBe(false); // preventDefault() called before ask()
    expect(el.value).toBe(''); // ask(text) cleared it
  });

  it('ignores Enter during IME composition', async () => {
    const view = renderWindow();
    const el = /** @type {HTMLTextAreaElement} */ (view.getByTestId('termi-input'));
    await fireEvent.input(el, { target: { value: 'hallo' } });

    const notPrevented = await fireEvent.keyDown(el, { key: 'Enter', isComposing: true });
    expect(notPrevented).toBe(true);
    expect(el.value).toBe('hallo');
  });

  it('grows with content up to five lines', async () => {
    const view = renderWindow();
    const el = /** @type {HTMLTextAreaElement} */ (view.getByTestId('termi-input'));
    Object.defineProperty(el, 'scrollHeight', { value: 200, configurable: true });
    vi.stubGlobal('getComputedStyle', /** @type {any} */ (() => ({ lineHeight: '20px' })));

    await fireEvent.input(el, { target: { value: 'eine\nzwei\ndrei\nvier\nfünf\nsechs' } });

    expect(el.style.height).toBe('100px'); // min(200, 5 * 20)
  });
});
