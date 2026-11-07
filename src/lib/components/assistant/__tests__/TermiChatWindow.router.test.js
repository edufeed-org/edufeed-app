/** @vitest-environment jsdom */
// Router answers (TERMI_AI_ENABLED): a typed sentence becomes a short bot
// line plus destination buttons, ranked by /api/termi or — when that fails —
// by keyword overlap. Flag off keeps the canned exact-match behaviour.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const PUBKEY = 'a'.repeat(64);
const NPUB = nip19.npubEncode(PUBKEY);

const mockConfig = vi.hoisted(() => ({
  termi: { enabled: true, embed: true, llm: false },
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
      return {
        contentTypes: ['people', 'events', 'learning', 'articles', 'boards', 'communities']
      };
    }
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'a'.repeat(64), type: 'nsec' })
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

const runCreateAction = vi.hoisted(() => vi.fn(() => true));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

import TermiChatWindow from '../TermiChatWindow.svelte';

/**
 * @param {Array<{skill: string, score: number}> | number} answer matches, or an HTTP status
 * @param {any[]} [items] what tier 1 (/api/termi/search) finds
 */
function stubRouter(answer, items = []) {
  const fetchMock = vi.fn(async (/** @type {string} */ url) =>
    url.startsWith('/api/termi/eligible')
      ? new Response(JSON.stringify({ eligible: true, gated: true }))
      : url === '/api/termi/search'
        ? new Response(JSON.stringify({ items, sourcesUnavailable: [] }))
        : typeof answer === 'number'
          ? new Response('', { status: answer })
          : new Response(JSON.stringify({ matches: answer }), { status: 200 })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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

/** @param {ReturnType<typeof renderWindow>} view @param {string} text */
async function type(view, text) {
  await fireEvent.input(view.getByTestId('termi-input'), { target: { value: text } });
  await fireEvent.click(view.getByTestId('termi-send'));
}

/** @param {ReturnType<typeof renderWindow>} view */
async function answerActions(view) {
  const box = await waitFor(() => view.getByTestId('termi-answer-actions'));
  return /** @type {HTMLElement[]} */ ([...box.querySelectorAll('a, button')]);
}

describe('TermiChatWindow router answers', () => {
  beforeEach(() => {
    mockConfig.termi = { enabled: true, embed: true, llm: false };
    mockConfig.help = { url: '/wiki/edufeed-erste-schritte' };
    runCreateAction.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('flag off: typed text keeps the canned fallback and never calls the router', async () => {
    mockConfig.termi = { enabled: false, embed: false, llm: false };
    vi.useFakeTimers();
    const fetchMock = stubRouter([{ skill: 'home', score: 0.95 }]);
    const view = renderWindow();
    await type(view, 'Zur Startseite');
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.getByText(m.termi_fallback())).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confident navigate → one link to /c/', async () => {
    const fetchMock = stubRouter([
      { skill: 'home', score: 0.92 },
      { skill: 'calendar', score: 0.6 }
    ]);
    const view = renderWindow();
    await type(view, 'Bring mich heim');
    const actions = await answerActions(view);
    expect(actions).toHaveLength(1);
    expect(actions[0].getAttribute('href')).toBe('/c/');
    expect(actions[0].className).toContain('btn-sm');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/termi',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('my-content resolves to the own profile', async () => {
    stubRouter([{ skill: 'my-content', score: 0.9 }]);
    const view = renderWindow();
    await type(view, 'wo sind meine sachen');
    const [link] = await answerActions(view);
    expect(link.getAttribute('href')).toBe(`/p/${NPUB}`);
  });

  it('maybe → "Meinst du …?" with up to three buttons', async () => {
    stubRouter([
      { skill: 'calendar', score: 0.78 },
      { skill: 'inbox', score: 0.76 },
      { skill: 'settings', score: 0.74 },
      { skill: 'home', score: 0.73 }
    ]);
    const view = renderWindow();
    await type(view, 'irgendwas mit terminen');
    const actions = await answerActions(view);
    expect(view.getByText(m.termi_route_maybe(), { exact: false })).toBeTruthy();
    expect(actions.map((a) => a.getAttribute('href'))).toEqual([
      '/calendar',
      '/inbox',
      '/settings'
    ]);
  });

  it('a content question takes the content path, never "Meinst du …?"', async () => {
    const fetchMock = stubRouter(
      [{ skill: 'my-communities', score: 0.76 }],
      [
        { type: 'community', id: 'c1', title: 'e-teaching.org', href: '/c/npub1abc' },
        { type: 'resource', id: 'r1', title: 'Extern', sourceUrl: 'https://example.org/x' }
      ]
    );
    const view = renderWindow();
    await type(view, 'ich suche die e-teaching community');
    const actions = await answerActions(view);
    expect(view.queryByText(m.termi_route_maybe(), { exact: false })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/termi/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'ich suche die e-teaching community', locale: 'de' })
      })
    );
    expect(actions.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['e-teaching.org', '/c/npub1abc'],
      ['Extern', 'https://example.org/x']
    ]);
    expect(actions[1].getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('"Zeig mir den Kalender" → confident navigate, no content search', async () => {
    const fetchMock = stubRouter([{ skill: 'calendar', score: 0.95 }]);
    const view = renderWindow();
    await type(view, 'Zeig mir den Kalender');
    const actions = await answerActions(view);
    expect(actions.map((a) => a.getAttribute('href'))).toEqual(['/calendar']);
    expect(fetchMock).not.toHaveBeenCalledWith('/api/termi/search', expect.anything());
  });

  it('off-topic: the content path finds nothing → fallback line plus home, search and help buttons', async () => {
    const fetchMock = stubRouter([{ skill: 'home', score: 0.2 }]);
    const view = renderWindow();
    await type(view, 'Wie wird das Wetter morgen?');
    const actions = await answerActions(view);
    expect(fetchMock).toHaveBeenCalledWith('/api/termi/search', expect.anything());
    expect(view.getByText(m.termi_fallback(), { exact: false })).toBeTruthy();
    expect(actions.map((a) => a.getAttribute('href'))).toEqual([
      '/c/',
      '/discover?type=learning',
      '/wiki/edufeed-erste-schritte'
    ]);
  });

  it('/api/termi 503 → the keyword path still answers', async () => {
    stubRouter(503);
    const view = renderWindow();
    // Exact calendar phrase: no other skill's phrase shares enough tokens to
    // stay within the tuned keyword MARGIN, so this stays "confident" (one link).
    await type(view, 'Was ist diese Woche los?');
    const actions = await answerActions(view);
    expect(actions).toHaveLength(1);
    expect(actions[0].getAttribute('href')).toBe('/calendar');
  });

  it('a network error → the keyword path still answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    const view = renderWindow();
    await type(view, 'Zeig mir den Kalender');
    const [link] = await answerActions(view);
    expect(link.getAttribute('href')).toBe('/calendar');
  });

  it('create skill button runs the create action', async () => {
    stubRouter([{ skill: 'create.article', score: 0.9 }]);
    const view = renderWindow();
    await type(view, 'Ich will was schreiben');
    const [button] = await answerActions(view);
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent?.trim()).toBe(m.article_fab_write());
    await fireEvent.click(button);
    expect(runCreateAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'article' }),
      expect.any(Object)
    );
  });

  it('a stalled /api/termi request times out into the keyword answer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (/** @type {string} */ _url, /** @type {RequestInit} */ init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          })
      )
    );
    const view = renderWindow();
    await type(view, 'Zeig mir den Kalender');
    expect(view.container.querySelector('.termi-typing')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(4_100);
    const box = view.getByTestId('termi-answer-actions');
    expect(box.querySelector('a')?.getAttribute('href')).toBe('/calendar');
    expect(view.container.querySelector('.termi-typing')).toBeNull();
  });

  it('without a help URL the getting-started help skill is never the answer', async () => {
    mockConfig.help = { url: null };
    stubRouter([{ skill: 'help.3', score: 0.95 }]);
    const view = renderWindow();
    await type(view, 'Wie fange ich an?');
    await answerActions(view);
    expect(view.queryByText(m.termi_sugg_4_a(), { exact: false })).toBeNull();
    expect(view.getByText(m.termi_fallback(), { exact: false })).toBeTruthy();
  });

  it('a suggestion chip still gets its canned answer', async () => {
    vi.useFakeTimers();
    const fetchMock = stubRouter([{ skill: 'home', score: 0.95 }]);
    const view = renderWindow();
    await fireEvent.click(view.getByText(m.termi_sugg_1_q()));
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.getByText(m.termi_sugg_1_a())).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
