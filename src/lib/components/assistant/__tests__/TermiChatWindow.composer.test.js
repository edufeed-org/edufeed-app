/** @vitest-environment jsdom */
// Multiline composer: Enter sends, Shift+Enter breaks the line, IME
// composition never triggers a send, and the textarea grows with content
// up to a five-line cap.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const mockConfig = vi.hoisted(() => ({
  termi: { enabled: false, embed: false, llm: false },
  help: /** @type {{ url: string | null }} */ ({ url: '/wiki/edufeed-erste-schritte' })
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return { enabled: false, handleDomain: 'edufeed.org' };
    },
    get help() {
      return mockConfig.help;
    },
    get termi() {
      return mockConfig.termi;
    },
    get discover() {
      return { contentTypes: ['events', 'learning', 'articles'] };
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'a'.repeat(64), type: 'nsec' })
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction: vi.fn() }));
vi.mock('$lib/services/blocked-authors.svelte.js', () => ({
  isBlockedAuthor: () => false,
  getBlockedAuthorsVersion: () => 0
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

import TermiChatWindow from '../TermiChatWindow.svelte';

function renderWindow() {
  return render(TermiChatWindow, {
    props: {
      onToggleExpand: () => {},
      onClose: () => {},
      hints: [],
      openCount: 0,
      runHint: vi.fn(),
      customizeHint: vi.fn(),
      dismissHint: vi.fn()
    }
  });
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
