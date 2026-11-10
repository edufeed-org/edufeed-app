/** @vitest-environment jsdom */
// Router answers (TERMI_AI_ENABLED): a typed sentence becomes a short bot
// line plus destination buttons, ranked by /api/termi or — when that fails —
// by keyword overlap. Flag off keeps the canned exact-match behaviour.
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const PUBKEY = 'a'.repeat(64);

const mockConfig = termiEnv.config;
mockConfig.termi = { enabled: true, embed: true, llm: false };
mockConfig.discover = {
  contentTypes: ['people', 'events', 'learning', 'articles', 'boards', 'communities']
};
termiEnv.user = { pubkey: PUBKEY, type: 'nsec' };

const runCreateAction = termiEnv.runCreateAction;
vi.mock('$lib/services/blocked-authors.svelte.js', () => ({
  isBlockedAuthor: (/** @type {string} */ pk) => pk === 'b'.repeat(64),
  getBlockedAuthorsVersion: () => 0
}));

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
  return render(TermiChatWindow, { props: windowProps() });
}

/** @param {ReturnType<typeof renderWindow>} view @param {string} text */
async function type(view, text) {
  await fireEvent.input(view.getByTestId('termi-input'), { target: { value: text } });
  await fireEvent.click(view.getByTestId('termi-send'));
}

/** The primary/secondary links of every result card. @param {ReturnType<typeof renderWindow>} view */
async function cardLinks(view) {
  await waitFor(() =>
    expect(view.container.querySelector('article[data-testid^="termi-card-"]')).toBeTruthy()
  );
  return /** @type {HTMLElement[]} */ ([
    ...view.container.querySelectorAll('article[data-testid^="termi-card-"] a')
  ]);
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

  it('content links: external passages open safely, unsafe hrefs and empty titles get no card', async () => {
    stubRouter(
      [],
      [
        { type: 'passage', id: 'p1', title: 'Passage', href: 'https://example.org/p' },
        { type: 'resource', id: 'r1', title: 'Protocol-relative', href: '//evil.example/x' },
        { type: 'resource', id: 'r2', title: 'Script', href: 'javascript:alert(1)' },
        { type: 'resource', id: 'r3', title: '', href: '/r/naddr1x' },
        { type: 'community', id: 'c1', title: 'Intern', href: '/c/npub1abc' }
      ]
    );
    const view = renderWindow();
    await type(view, 'Was ist OER?');
    const links = await cardLinks(view);
    // passages render below the card grid
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/c/npub1abc',
      'https://example.org/p'
    ]);
    expect(links[1].getAttribute('target')).toBe('_blank');
    expect(links[1].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].getAttribute('target')).toBeNull();
    expect(view.container.innerHTML).not.toContain('//evil.example');
    expect(view.container.innerHTML).not.toContain('javascript:');
  });

  it('a failed source shows the note; "Erneut versuchen" asks tier 1 again', async () => {
    const fetchMock = vi.fn(async (/** @type {string} */ url) =>
      url === '/api/termi/search'
        ? new Response(
            JSON.stringify({
              items: [{ type: 'community', id: 'c1', title: 'Intern', href: '/c/npub1abc' }],
              sourcesUnavailable: ['search_events']
            })
          )
        : new Response(JSON.stringify({ matches: [] }))
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = renderWindow();
    await type(view, 'Welche Fortbildungen gibt es zu OER?');
    await waitFor(() => view.getByText(m.termi_sources_events()));
    await fireEvent.click(view.getByText(m.termi_sources_retry()));
    await waitFor(() => expect(view.getAllByText(m.termi_sources_events())).toHaveLength(2));
    const searches = fetchMock.mock.calls.filter(([u]) => u === '/api/termi/search');
    expect(searches).toHaveLength(2);
    expect(JSON.parse(String(/** @type {any} */ (searches[1])[1].body)).text).toBe(
      'Welche Fortbildungen gibt es zu OER?'
    );
  });

  it('"Material von …" searches by the person key; a name-only person by the name', async () => {
    const pk = 'c'.repeat(64);
    const fetchMock = stubRouter(
      [],
      [
        { type: 'person', id: pk, pubkey: pk, title: 'Ada Lovelace', href: '/p/npub1ada' },
        { type: 'person', id: 'name:Grace Hopper', title: 'Grace Hopper' }
      ]
    );
    const view = renderWindow();
    await type(view, 'Wer schreibt über Mathematik?');
    const searches = () =>
      /** @type {any[][]} */ (fetchMock.mock.calls)
        .filter(([u]) => u === '/api/termi/search')
        .map(([, init]) => JSON.parse(String(init.body)));
    const ada = m.termi_card_author_search({ name: 'Ada Lovelace' });
    await fireEvent.click(await waitFor(() => view.getAllByText(ada)[0]));
    await waitFor(() => expect(searches()).toHaveLength(2));
    expect(searches()[1]).toEqual({ text: 'Ada Lovelace', locale: 'de', authors: [pk] });
    await waitFor(() => expect(view.getAllByText(m.termi_route_go())).toHaveLength(2));
    const grace = m.termi_card_author_search({ name: 'Grace Hopper' });
    await fireEvent.click(view.getAllByText(grace)[0]);
    await waitFor(() => expect(searches()).toHaveLength(3));
    expect(searches()[2]).toEqual({ text: 'Grace Hopper', locale: 'de' });
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
});
