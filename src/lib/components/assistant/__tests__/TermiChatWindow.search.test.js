/** @vitest-environment jsdom */
// Window integration of the two content tiers: a failed tier 2 (quota,
// gate, stream error) falls back to one tier-1 search for the same
// sentence; an empty content answer offers the router's best guesses; the
// typing state blocks a second question; chips follow the locale.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { _resetTermiEligibilityForTests } from '../termi-router.js';

overwriteGetLocale(() => 'de');

const SK = generateSecretKey();
const user = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
user.current = {
  pubkey: getPublicKey(SK),
  type: 'nsec',
  signer: { signEvent: async (/** @type {any} */ draft) => finalizeEvent(draft, SK) }
};

const mockConfig = vi.hoisted(() => ({
  termi: { enabled: true, embed: true, llm: true }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return { enabled: false, handleDomain: 'edufeed.org' };
    },
    get help() {
      return { url: '/wiki/edufeed-erste-schritte' };
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
  useActiveUser: () => () => user.current
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

import TermiChatWindow from '../TermiChatWindow.svelte';

const ITEMS = [
  { type: 'resource', id: '30142:pk:1', title: 'Brüche verstehen', href: '/naddr1one' },
  { type: 'resource', id: '30142:pk:2', title: 'Bruchrechnen üben', href: '/naddr1two' }
];

/**
 * @param {{
 *   chat?: () => Response | Promise<Response>,
 *   router?: number | Array<{ skill: string, score: number }>,
 *   items?: any[] | (() => Promise<Response>)
 * }} opts router: matches or an HTTP status (→ keyword path)
 */
function stubFetch({ chat = () => new Response('{}', { status: 500 }), router = [], items = [] }) {
  const fetchMock = vi.fn(async (/** @type {string} */ url) => {
    if (url.startsWith('/api/termi/eligible')) {
      return new Response(JSON.stringify({ eligible: true, gated: true }));
    }
    if (url === '/api/termi') {
      return typeof router === 'number'
        ? new Response('', { status: router })
        : new Response(JSON.stringify({ matches: router }));
    }
    if (url === '/api/termi/search') {
      return typeof items === 'function'
        ? items()
        : new Response(JSON.stringify({ items, sourcesUnavailable: [] }));
    }
    return chat();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** @param {ReturnType<typeof stubFetch>} fetchMock */
const searchBodies = (fetchMock) =>
  /** @type {any[][]} */ (fetchMock.mock.calls)
    .filter(([u]) => u === '/api/termi/search')
    .map(([, init]) => JSON.parse(String(init.body)));

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

const Q = 'Finde Materialien zu Brüchen';

describe('TermiChatWindow tier 2 failure → tier 1', () => {
  beforeEach(() => {
    mockConfig.termi = { enabled: true, embed: true, llm: true };
    _resetTermiEligibilityForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('HTTP 429 → the quota line with tier-1 cards for the same sentence, searched once', async () => {
    const fetchMock = stubFetch({
      chat: () => new Response(JSON.stringify({ error: 'quota', scope: 'user' }), { status: 429 }),
      items: ITEMS
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    expect(view.getByText(m.termi_quota(), { exact: false })).toBeTruthy();
    expect(searchBodies(fetchMock)).toEqual([{ text: Q, locale: 'de' }]);
  });

  it.each([
    [403, { error: 'not_eligible' }, () => m.termi_assistant_not_eligible()],
    [503, { error: 'eligibility_unknown' }, () => m.termi_assistant_unavailable()]
  ])('HTTP %i → its line with tier-1 cards, back to router mode', async (status, body, line) => {
    const fetchMock = stubFetch({
      chat: () => new Response(JSON.stringify(body), { status }),
      items: ITEMS
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    expect(view.getByText(line(), { exact: false })).toBeTruthy();
    expect(searchBodies(fetchMock)).toEqual([{ text: Q, locale: 'de' }]);
    expect(view.queryByText(m.termi_assistant_restart())).toBeNull();
  });

  it('a termi:upstream stream error → tier-1 cards, "Erneut senden" kept', async () => {
    const fetchMock = stubFetch({
      chat: () =>
        createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => writer.write({ type: 'error', errorText: 'termi:upstream' })
          })
        }),
      items: ITEMS
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    expect(view.getByText(m.termi_assistant_retry())).toBeTruthy();
    expect(searchBodies(fetchMock)).toEqual([{ text: Q, locale: 'de' }]);
  });

  it('"Erneut senden" failing again → still one search, the same cards', async () => {
    const fetchMock = stubFetch({
      chat: () =>
        createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => writer.write({ type: 'error', errorText: 'termi:upstream' })
          })
        }),
      items: ITEMS
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    const chats = () => fetchMock.mock.calls.filter(([u]) => u === '/api/termi/chat').length;
    expect(chats()).toBe(1);
    await fireEvent.click(view.getByText(m.termi_assistant_retry()));
    await waitFor(() => expect(chats()).toBe(2));
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    expect(view.getByText(m.termi_assistant_retry())).toBeTruthy();
    expect(searchBodies(fetchMock)).toHaveLength(1);
  });

  it('"Neu anfangen" while the rescue search runs → no stuck typing dots, new questions go out', async () => {
    /** @type {(r: Response) => void} */
    let answer = () => {};
    const fetchMock = stubFetch({
      chat: () => new Response(JSON.stringify({ error: 'quota', scope: 'user' }), { status: 429 }),
      items: () => new Promise((resolve) => (answer = resolve))
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => expect(searchBodies(fetchMock)).toHaveLength(1));
    await fireEvent.click(view.getByText(m.termi_assistant_restart()));
    answer(new Response(JSON.stringify({ items: ITEMS, sourcesUnavailable: [] })));
    await waitFor(() => expect(view.container.querySelector('.termi-typing')).toBeNull());
    const routed = () => fetchMock.mock.calls.filter(([u]) => u === '/api/termi').length;
    await type(view, 'Noch eine Frage');
    await waitFor(() => expect(routed()).toBe(2));
  });

  it('an account switch during the fallback search drops its answer', async () => {
    const real = user.current;
    /** @type {(r: Response) => void} */
    let answer = () => {};
    const fetchMock = stubFetch({
      chat: () => new Response(JSON.stringify({ error: 'not_eligible' }), { status: 403 }),
      items: () => new Promise((resolve) => (answer = resolve))
    });
    try {
      const view = renderWindow();
      await type(view, Q);
      await waitFor(() => expect(searchBodies(fetchMock)).toHaveLength(1));
      user.current = { ...real, pubkey: 'd'.repeat(64) };
      answer(new Response(JSON.stringify({ items: ITEMS, sourcesUnavailable: [] })));
      await waitFor(() => expect(view.container.querySelector('.termi-typing')).toBeNull());
      expect(view.queryAllByTestId('termi-card-resource')).toHaveLength(0);
      expect(view.queryByText(m.termi_assistant_not_eligible(), { exact: false })).toBeNull();
    } finally {
      user.current = real;
    }
  });

  it('fallback search with an unreachable source → the sources note and retry, not "nothing"', async () => {
    stubFetch({
      chat: () => new Response(JSON.stringify({ error: 'eligibility_unknown' }), { status: 503 }),
      items: async () =>
        new Response(JSON.stringify({ items: [], sourcesUnavailable: ['search_events'] }))
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => view.getByText(m.termi_sources_events()));
    expect(view.getByText(m.termi_sources_retry())).toBeTruthy();
    expect(view.getByText(m.termi_assistant_unavailable(), { exact: false })).toBeTruthy();
    expect(view.getByText(m.termi_quota_link()).getAttribute('href')).toBe(
      '/discover?type=learning&search=Br%C3%BCchen'
    );
  });

  it('tier 1 finds nothing as well → the line plus the learning search link', async () => {
    stubFetch({
      chat: () => new Response(JSON.stringify({ error: 'quota', scope: 'user' }), { status: 429 })
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => view.getByText(m.termi_quota(), { exact: false }));
    expect(view.getByText(m.termi_quota_link()).getAttribute('href')).toBe(
      '/discover?type=learning&search=Br%C3%BCchen'
    );
    expect(view.queryAllByTestId('termi-card-resource')).toHaveLength(0);
  });
});

describe('TermiChatWindow nothing found → the router’s best guess', () => {
  beforeEach(() => _resetTermiEligibilityForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('tier 1: "hab ich neue nachrichten?" (keyword path) → an inbox button', async () => {
    mockConfig.termi = { enabled: true, embed: true, llm: false };
    stubFetch({ router: 503 });
    const view = renderWindow();
    await type(view, 'hab ich neue nachrichten?');
    const box = await waitFor(() => view.getByTestId('termi-answer-actions'));
    expect(view.getByText(m.termi_route_maybe(), { exact: false })).toBeTruthy();
    const inbox = [...box.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/inbox');
    expect(inbox?.textContent?.trim()).toBe(m.termi_route_inbox());
  });

  it('tier 2 answers with neither items nor text → the fallback with the guess', async () => {
    mockConfig.termi = { enabled: true, embed: true, llm: true };
    stubFetch({
      router: [{ skill: 'inbox', score: 0.75 }],
      chat: () =>
        createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: 'start-step' });
              writer.write({
                type: 'tool-input-available',
                toolCallId: 'c1',
                toolName: 'search_content',
                input: { query: 'nachrichten' }
              });
              writer.write({
                type: 'tool-output-available',
                toolCallId: 'c1',
                output: { items: [], sourcesUnavailable: [] }
              });
              writer.write({ type: 'finish-step' });
            }
          })
        })
    });
    const view = renderWindow();
    await type(view, 'hab ich neue nachrichten?');
    const box = await waitFor(() => view.getByTestId('termi-answer-actions'));
    expect(view.getByText(m.termi_nothing_found(), { exact: false })).toBeTruthy();
    expect(view.queryByText(m.termi_fallback(), { exact: false })).toBeNull();
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/inbox');
  });

  it('tier 1 with cards: the guess buttons still show above the cards', async () => {
    mockConfig.termi = { enabled: true, embed: true, llm: false };
    stubFetch({ router: 503, items: ITEMS });
    const view = renderWindow();
    await type(view, 'hab ich neue nachrichten?');
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    const box = view.getByTestId('termi-answer-actions');
    expect(view.getByText(m.termi_route_maybe(), { exact: false })).toBeTruthy();
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/inbox');
  });

  it('tier 2 with a text answer: the guess buttons show under it', async () => {
    mockConfig.termi = { enabled: true, embed: true, llm: true };
    stubFetch({
      router: [{ skill: 'inbox', score: 0.75 }],
      chat: () =>
        createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: 'text-start', id: 't1' });
              writer.write({ type: 'text-delta', id: 't1', delta: 'Nachrichten findest du …' });
              writer.write({ type: 'text-end', id: 't1' });
            }
          })
        })
    });
    const view = renderWindow();
    await type(view, 'hab ich neue nachrichten?');
    await waitFor(() => view.getByText('Nachrichten findest du …'));
    const box = await waitFor(() => view.getByTestId('termi-answer-actions'));
    expect(view.getByText(m.termi_route_maybe(), { exact: false })).toBeTruthy();
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/inbox');
  });
});

describe('TermiChatWindow "Material von …" in the assistant', () => {
  beforeEach(() => {
    mockConfig.termi = { enabled: true, embed: true, llm: true };
    _resetTermiEligibilityForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the model with the person key, so it can pass it to `authors`', async () => {
    const PK = 'a'.repeat(64);
    const fetchMock = stubFetch({
      chat: () =>
        createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: 'start-step' });
              writer.write({
                type: 'tool-input-available',
                toolCallId: 'c1',
                toolName: 'find_people',
                input: { query: 'Ada' }
              });
              writer.write({
                type: 'tool-output-available',
                toolCallId: 'c1',
                output: {
                  items: [{ type: 'person', id: PK, pubkey: PK, title: 'Ada', href: '/p/npub1a' }],
                  sourcesUnavailable: []
                }
              });
              writer.write({ type: 'finish-step' });
            }
          })
        })
    });
    const view = renderWindow();
    await type(view, 'Wer ist Ada?');
    const label = m.termi_card_author_search({ name: 'Ada' });
    const chats = () => fetchMock.mock.calls.filter(([u]) => u === '/api/termi/chat');
    // The card shows while the stream still runs; a click then is ignored, so retry until sent.
    await waitFor(async () => {
      if (chats().length < 2) await fireEvent.click(view.getByText(label));
      expect(chats()).toHaveLength(2);
    });
    const [, init] = /** @type {any[]} */ (chats().at(-1));
    expect(String(init.body)).toContain(`${label} (${PK})`);
  });
});

describe('TermiChatWindow pending state and locale', () => {
  beforeEach(() => {
    mockConfig.termi = { enabled: true, embed: true, llm: false };
    _resetTermiEligibilityForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('while tier 1 runs: typing dots, the input stays usable, a second question is blocked', async () => {
    /** @type {(r: Response) => void} */
    let answer = () => {};
    const fetchMock = stubFetch({
      items: () => new Promise((resolve) => (answer = resolve))
    });
    const view = renderWindow();
    await type(view, Q);
    await waitFor(() => expect(searchBodies(fetchMock)).toHaveLength(1));
    expect(view.container.querySelector('.termi-typing')).toBeTruthy();
    const input = /** @type {HTMLInputElement} */ (view.getByTestId('termi-input'));
    expect(input.disabled).toBe(false);
    await type(view, 'Noch eine Frage');
    // Blocked, not lost: the text stays in the input, nothing is sent.
    expect(input.value).toBe('Noch eine Frage');
    expect(view.queryByText('Noch eine Frage', { selector: 'div' })).toBeNull();
    answer(new Response(JSON.stringify({ items: ITEMS, sourcesUnavailable: [] })));
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    expect(view.container.querySelector('.termi-typing')).toBeNull();
    expect(searchBodies(fetchMock)).toHaveLength(1);
  });

  it('locale de → German chips and greeting', () => {
    const view = renderWindow();
    expect(view.getByText('Was kannst du?')).toBeTruthy();
    expect(view.getByText(/^Hallo! Ich bin Termi/)).toBeTruthy();
  });
});
