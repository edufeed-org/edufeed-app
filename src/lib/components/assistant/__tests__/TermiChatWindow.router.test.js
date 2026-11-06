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
  help: { url: '/wiki/edufeed-erste-schritte' }
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

/** @param {Array<{skill: string, score: number}> | number} answer matches, or an HTTP status */
function stubRouter(answer) {
  const fetchMock = vi.fn(async () =>
    typeof answer === 'number'
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

  it('search with a query → discover link carrying the query', async () => {
    stubRouter([{ skill: 'search.learning', score: 0.9 }]);
    const view = renderWindow();
    await type(view, 'Ich suche Materialien zur Aktivierung von Studierenden');
    const [link] = await answerActions(view);
    expect(link.getAttribute('href')).toBe(
      '/discover?type=learning&search=Aktivierung%20von%20Studierenden'
    );
  });

  it('search with nothing left after extraction → link without search=', async () => {
    stubRouter([{ skill: 'search.learning', score: 0.9 }]);
    const view = renderWindow();
    await type(view, 'ich suche was');
    const [link] = await answerActions(view);
    expect(link.getAttribute('href')).toBe('/discover?type=learning');
  });

  it('maybe → "Meinst du …?" with up to three buttons', async () => {
    stubRouter([
      { skill: 'calendar', score: 0.78 },
      { skill: 'search.events', score: 0.76 },
      { skill: 'settings', score: 0.74 },
      { skill: 'home', score: 0.73 }
    ]);
    const view = renderWindow();
    await type(view, 'irgendwas mit terminen');
    const actions = await answerActions(view);
    expect(view.getByText(m.termi_route_maybe(), { exact: false })).toBeTruthy();
    expect(actions.map((a) => a.getAttribute('href'))).toEqual([
      '/calendar',
      '/discover?type=events&search=irgendwas%20mit%20terminen',
      '/settings'
    ]);
  });

  it('none → fallback line plus home, search and help buttons', async () => {
    stubRouter([{ skill: 'home', score: 0.2 }]);
    const view = renderWindow();
    await type(view, 'Wie wird das Wetter morgen?');
    const actions = await answerActions(view);
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
    await type(view, 'Zeig mir den Kalender');
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

  it('assistant.search falls back to the learning-search link until the chat exists', async () => {
    mockConfig.termi = { enabled: true, embed: true, llm: true };
    stubRouter([{ skill: 'assistant.search', score: 0.9 }]);
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Demokratie');
    const [link] = await answerActions(view);
    expect(link.getAttribute('href')).toBe('/discover?type=learning&search=Demokratie');
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
