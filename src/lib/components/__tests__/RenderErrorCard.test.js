/**
 * RenderErrorCard — fallback UI for the route-level <svelte:boundary>.
 *
 * A render error in one page (e.g. each_key_duplicate from a malformed
 * event) must degrade to this card instead of killing the whole app shell.
 * The card retries via the boundary's reset, and auto-resets when the user
 * navigates away so the next page renders normally. Logged-in users can
 * report the error as a public NIP-34 issue, prefilled with the error and
 * the page context (never event content, keys or account data).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const { navigateCallbacks } = vi.hoisted(() => ({
  navigateCallbacks: /** @type {Array<() => void>} */ ([])
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: (/** @type {() => void} */ cb) => navigateCallbacks.push(cb)
}));

const mockModalStore = vi.hoisted(() => ({ openModal: vi.fn() }));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

const activeUserHolder = vi.hoisted(() => ({ value: /** @type {any} */ (null) }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => activeUserHolder.value
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appName: 'Edufeed' }
}));

import RenderErrorCard from '../shared/RenderErrorCard.svelte';
import renderErrorCardSource from '../shared/RenderErrorCard.svelte?raw';

const USER = { pubkey: 'a'.repeat(64), signer: { signEvent: vi.fn() } };

describe('RenderErrorCard', () => {
  beforeEach(() => {
    navigateCallbacks.length = 0;
    mockModalStore.openModal.mockReset();
    activeUserHolder.value = USER;
  });

  it('renders a retry button that calls onretry', async () => {
    const onretry = vi.fn();
    const { container } = render(RenderErrorCard, {
      props: { error: new Error('boom'), onretry }
    });

    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    await fireEvent.click(/** @type {Element} */ (button));
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  it('shows the error message as detail', () => {
    const { container } = render(RenderErrorCard, {
      props: { error: new Error('each_key_duplicate'), onretry: () => {} }
    });
    expect(container.textContent).toContain('each_key_duplicate');
  });

  it('auto-resets on navigation so the next page is not stuck on the error', () => {
    const onretry = vi.fn();
    render(RenderErrorCard, { props: { error: new Error('boom'), onretry } });

    expect(navigateCallbacks.length).toBe(1);
    navigateCallbacks[0]();
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  describe('report button', () => {
    it('opens the issue modal prefilled with the error, trimmed stack, route, version and UA', async () => {
      const error = new Error('each_key_duplicate');
      error.stack = [
        'Error: each_key_duplicate',
        ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (chunk.js:${i}:1)`)
      ].join('\n');
      const { getByTestId, queryByTestId } = render(RenderErrorCard, {
        props: { error, onretry: () => {} }
      });

      const button = /** @type {HTMLButtonElement} */ (getByTestId('render-error-report'));
      expect(button.disabled).toBe(false);
      expect(queryByTestId('render-error-report-hint')).toBeNull();
      await fireEvent.click(button);

      expect(mockModalStore.openModal).toHaveBeenCalledTimes(1);
      const [type, props] = mockModalStore.openModal.mock.calls[0];
      expect(type).toBe('reportIssue');
      const { prefill } = props;
      expect(prefill.type).toBe('bug');
      expect(prefill.subject).toContain('each_key_duplicate');
      expect(prefill.context.errorMessage).toBe('each_key_duplicate');
      expect(prefill.context.errorStack.split('\n')).toHaveLength(16);
      // 15 lines = the message line + 14 frames, then the cut marker.
      expect(prefill.context.errorStack).toContain('frame13');
      expect(prefill.context.errorStack).not.toContain('frame14');
      expect(prefill.context.errorStack).toContain('… (16 more lines)');
      expect(prefill.context.route).toBe(window.location.pathname);
      expect(prefill.context.appName).toBe('Edufeed');
      expect(typeof prefill.context.version).toBe('string');
      expect(prefill.context.userAgent).toBe(navigator.userAgent);
      // Allow-list only: nothing else rides along.
      expect(Object.keys(prefill.context).sort()).toEqual(
        ['appName', 'errorMessage', 'errorStack', 'origin', 'route', 'userAgent', 'version'].sort()
      );
    });

    it('is disabled with a login hint when nobody is logged in', async () => {
      activeUserHolder.value = null;
      const { getByTestId } = render(RenderErrorCard, {
        props: { error: new Error('boom'), onretry: () => {} }
      });
      const button = /** @type {HTMLButtonElement} */ (getByTestId('render-error-report'));
      expect(button.disabled).toBe(true);
      expect(getByTestId('render-error-report-hint')).toBeTruthy();
      await fireEvent.click(button);
      expect(mockModalStore.openModal).not.toHaveBeenCalled();
    });

    it('never statically imports the report modal (root layout import budget)', () => {
      const staticImports = renderErrorCardSource
        .split('\n')
        .filter((line) => /^\s*import\s/.test(line));
      expect(staticImports.some((l) => l.includes('ReportIssueModal'))).toBe(false);
    });
  });
});
