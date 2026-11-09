/** @vitest-environment jsdom */
// Conversation history in the window: record after each exchange, reopen
// (tier 1 → msgs; tier 2 → the chat only when it runs), "Neue Unterhaltung".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const SK = generateSecretKey();
const user = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
const fake = vi.hoisted(() => ({
  store: /** @type {any} */ (null),
  scopes: /** @type {string[]} */ ([])
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
      return { enabled: true, embed: true, llm: true };
    },
    get discover() {
      return { contentTypes: ['events', 'learning', 'articles'] };
    }
  }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => user.current }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getReplaceable: () => undefined }
}));
vi.mock('$lib/stores/calendar-actions.svelte.js', () => ({
  createCalendarActions: () => ({ createEvent: async () => ({}) })
}));
vi.mock('$lib/helpers/calendar-import/index.js', async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  extractText: async () => ({ text: 'Elternabend 01.12. 19 Uhr', kind: 'zip', truncated: false })
}));
vi.mock('../history/conversation-store.svelte.js', () => ({
  createRelaySync: vi.fn(() => ({})),
  createConversationStore: vi.fn(({ scope }) => {
    fake.scopes.push(scope);
    return fake.store;
  })
}));

import TermiChatWindow from '../TermiChatWindow.svelte';
import { fromContent, toContent } from '../history/conversation-codec.js';
import { _resetTermiEligibilityForTests } from '../termi-router.js';

const item = (/** @type {number} */ n) => ({
  type: 'resource',
  id: `30142:pk:${n}`,
  title: `Material ${n}`,
  href: `/naddr1x${n}`
});

/** @param {any} conv */
function makeStore(conv = null) {
  return {
    list: conv ? [{ id: conv.id, title: conv.title, createdAt: 1, updatedAt: 1 }] : [],
    current: null,
    refresh: vi.fn(async () => {}),
    open: vi.fn(async () => conv),
    startNew: vi.fn(),
    record: vi.fn(),
    remove: vi.fn(async () => {}),
    dispose: vi.fn()
  };
}

/** @type {Array<{ url: string, init: RequestInit }>} */
let chatCalls;

/** A search_content call with 3 results, then text — what the `ask` chat streams. */
function streamWithCards() {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start-step' });
        writer.write({
          type: 'tool-input-available',
          toolCallId: 'k1',
          toolName: 'search_content',
          input: { query: 'Brüche' }
        });
        writer.write({
          type: 'tool-output-available',
          toolCallId: 'k1',
          output: { items: [item(1), item(2), item(3)], sourcesUnavailable: [] }
        });
        writer.write({ type: 'finish-step' });
        writer.write({ type: 'text-start', id: 't1' });
        writer.write({ type: 'text-delta', id: 't1', delta: 'Drei Treffer.' });
        writer.write({ type: 'text-end', id: 't1' });
      }
    })
  });
}

/** @type {() => Response} */
let chatAnswer;

function streamText(text = 'Live-Antwort.') {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'text-start', id: 't1' });
        writer.write({ type: 'text-delta', id: 't1', delta: text });
        writer.write({ type: 'text-end', id: 't1' });
      }
    })
  });
}

beforeEach(() => {
  _resetTermiEligibilityForTests();
  fake.scopes = [];
  fake.store = makeStore();
  user.current = null;
  chatCalls = [];
  chatAnswer = () => streamText();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
      if (url.startsWith('/api/termi/eligible')) {
        return new Response(JSON.stringify({ eligible: true, gated: true }));
      }
      if (url === '/api/termi') return new Response(JSON.stringify({ matches: [] }));
      if (url === '/api/termi/search') {
        return new Response(JSON.stringify({ items: [item(1), item(2)], sourcesUnavailable: [] }));
      }
      if (url === '/api/termi/extract') {
        return new Response(
          JSON.stringify({
            events: [{ title: 'Elternabend', startDate: '2026-12-01', startTime: '19:00' }]
          })
        );
      }
      if (url === '/api/termi/chat') {
        chatCalls.push({ url, init });
        return chatAnswer();
      }
      return new Response('{}', { status: 404 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function loginEligible() {
  user.current = {
    pubkey: getPublicKey(SK),
    type: 'nsec',
    signer: { signEvent: async (/** @type {any} */ d) => finalizeEvent(d, SK) }
  };
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
const sendIdle = (view) =>
  waitFor(() =>
    expect(/** @type {HTMLButtonElement} */ (view.getByTestId('termi-send')).disabled).toBe(false)
  );

/**
 * What `record` really stores for a tier-2 chat: the router question from `msgs`
 * (tier 1) plus the chat turns. @param {string[]} [followUps] @returns {Promise<any>}
 */
async function recordedTier2(followUps = []) {
  loginEligible();
  chatAnswer = () => streamWithCards();
  const view = renderWindow();
  await type(view, 'Finde Brüche');
  await waitFor(() => expect(fake.store.record).toHaveBeenCalledTimes(1));
  for (const [i, q] of followUps.entries()) {
    await sendIdle(view);
    await type(view, q);
    await waitFor(() => expect(fake.store.record).toHaveBeenCalledTimes(i + 2));
  }
  const turns = fake.store.record.mock.calls.at(-1)[0];
  view.unmount();
  chatCalls = [];
  chatAnswer = () => streamText();
  fake.store = makeStore({ id: 'c2', title: 'Brüche', createdAt: 1, updatedAt: 1, turns });
  return turns;
}

/** Start a live chat so `assistant` exists, then open the stored conversation. */
async function liveChatThenOpen() {
  loginEligible();
  const view = renderWindow();
  await type(view, 'Erste Frage');
  await waitFor(() => view.getByText('Live-Antwort.'));
  await sendIdle(view);
  await openStored(view);
  return view;
}

/** @param {ReturnType<typeof renderWindow>} view */
async function openStored(view) {
  await waitFor(() => view.getByTestId('termi-history-toggle'));
  await fireEvent.click(view.getByTestId('termi-history-toggle'));
  await fireEvent.click(view.getByTestId('termi-history-row'));
  await waitFor(() => expect(view.queryByTestId('termi-history')).toBeNull());
}

describe('TermiChatWindow history', () => {
  it('the history button is named and titled "Verlauf", its icon is decorative', async () => {
    const view = renderWindow();
    const toggle = await waitFor(() => view.getByTestId('termi-history-toggle'));
    expect(view.getByRole('button', { name: 'Verlauf' })).toBe(toggle);
    expect(toggle.getAttribute('title')).toBe('Verlauf');
    expect(toggle.querySelector('title')).toBeNull();
    expect(toggle.querySelector('[aria-label="Clock"]')).toBeNull();
  });

  it('anonymous: the store is scoped "anon"; a tier-1 reply records the question and the cards', async () => {
    const view = renderWindow();
    await waitFor(() => expect(fake.scopes).toEqual(['anon']));
    await type(view, 'Finde Material zu Brüchen');
    await waitFor(() => expect(fake.store.record).toHaveBeenCalled());
    const turns = fake.store.record.mock.calls.at(-1)[0];
    expect(turns[0]).toEqual({ role: 'user', text: 'Finde Material zu Brüchen', tier: 1 });
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].items).toHaveLength(2);
  });

  it('record stores the router question as tier 1 and the chat answer as tier 2 with its tool part', async () => {
    const turns = await recordedTier2();
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: 'user', text: 'Finde Brüche', tier: 1 });
    expect(turns[1]).toMatchObject({ role: 'assistant', text: 'Drei Treffer.', tier: 2 });
    expect(turns[1].toolParts[0].output.items).toHaveLength(3);
  });

  it('a stored tier-2 conversation opens read-only without an assistant: text plus 3 cards', async () => {
    await recordedTier2();
    user.current = null;
    const view = renderWindow();
    await openStored(view);
    expect(view.getByText('Finde Brüche')).toBeTruthy();
    expect(view.getByText('Drei Treffer.')).toBeTruthy();
    expect(view.getAllByTestId('termi-card-resource')).toHaveLength(3);
  });

  it('single exchange, as recorded: with a running chat it continues, tool part included', async () => {
    await recordedTier2();
    const view = await liveChatThenOpen();
    expect(view.queryByText('Erste Frage')).toBeNull();
    expect(view.getAllByText('Finde Brüche')).toHaveLength(1);
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(3));

    await type(view, 'Nur Klasse 6');
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    const sent = JSON.parse(String(chatCalls[1].init.body)).messages;
    expect(sent.map((/** @type {any} */ x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[0].parts[0].text).toBe('Finde Brüche');
    expect(sent[1].parts[0]).toMatchObject({ type: 'dynamic-tool', toolName: 'search_content' });
  });

  it('two exchanges, round-tripped through storage: the whole chat continues', async () => {
    const turns = await recordedTier2(['Nur Klasse 6']);
    const stored = fromContent(
      toContent({ id: 'c2', title: 'Brüche', createdAt: 1, updatedAt: 1, turns })
    );
    fake.store = makeStore(stored);
    const view = await liveChatThenOpen();
    expect(view.getAllByText('Finde Brüche')).toHaveLength(1);
    expect(view.getByText('Nur Klasse 6')).toBeTruthy();
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(6));

    await type(view, 'Und Klasse 7?');
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    const sent = JSON.parse(String(chatCalls[1].init.body)).messages;
    expect(sent.map((/** @type {any} */ x) => x.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user'
    ]);
  });

  it('a stored tier-1 conversation restores its first user bubble', async () => {
    fake.store = makeStore({
      id: 'c1',
      title: 'Bruch',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Bruchrechnen', tier: 1 },
        { role: 'assistant', text: 'Hier:', tier: 1, items: [item(1)], sourcesUnavailable: [] }
      ]
    });
    const view = renderWindow();
    await openStored(view);
    expect(view.getByText('Bruchrechnen')).toBeTruthy();
    expect(view.getAllByTestId('termi-card-resource')).toHaveLength(1);
  });

  it('"Neue Unterhaltung" clears the window and the chat', async () => {
    loginEligible();
    const view = renderWindow();
    await type(view, 'Erste Frage');
    await waitFor(() => view.getByText('Live-Antwort.'));
    await waitFor(() => expect(fake.store.record).toHaveBeenCalled());
    // the finished chat answer was recorded as a tier-2 turn
    const turns = fake.store.record.mock.calls.at(-1)[0];
    expect(turns.at(-1)).toMatchObject({ role: 'assistant', text: 'Live-Antwort.', tier: 2 });

    await fireEvent.click(view.getByText(m.termi_history_new()));
    expect(view.queryByText('Erste Frage')).toBeNull();
    expect(view.queryByText('Live-Antwort.')).toBeNull();
    expect(fake.store.startNew).toHaveBeenCalled();
  });

  it('a published import is recorded as a text-only turn', async () => {
    loginEligible();
    const view = renderWindow();
    await fireEvent.drop(view.getByTestId('termi-window'), {
      dataTransfer: { files: [new File(['xx'], 'plan.xlsx')], types: ['Files'] }
    });
    await waitFor(() => view.getByTestId('termi-attachment'));
    await type(view, '');
    await waitFor(() => view.getByText(m.termi_import_publish({ n: 1 })));
    expect(fake.store.record).not.toHaveBeenCalled();
    await fireEvent.click(view.getByText(m.termi_import_publish({ n: 1 })));
    await waitFor(() => expect(fake.store.record).toHaveBeenCalled());
    const turns = fake.store.record.mock.calls.at(-1)[0];
    expect(turns).toEqual([
      { role: 'user', text: m.termi_import_default_prompt({ file: 'plan.xlsx' }), tier: 1 },
      {
        role: 'assistant',
        text: m.termi_history_import_summary({ n: 1, file: 'plan.xlsx' }),
        tier: 1
      }
    ]);
  });

  it('an import during a running chat sits after the last chat message and is recorded last', async () => {
    loginEligible();
    const view = renderWindow();
    await type(view, 'Erste Frage');
    await waitFor(() => view.getByText('Live-Antwort.'));
    await sendIdle(view);
    await fireEvent.drop(view.getByTestId('termi-window'), {
      dataTransfer: { files: [new File(['xx'], 'plan.xlsx')], types: ['Files'] }
    });
    await waitFor(() => view.getByTestId('termi-attachment'));
    await type(view, 'Nur Dezember');
    const bubble = await waitFor(() => view.getByText('Nur Dezember'));
    const answer = view.getByText('Live-Antwort.');
    expect(answer.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => view.getByText(m.termi_import_publish({ n: 1 })));
    await fireEvent.click(view.getByText(m.termi_import_publish({ n: 1 })));
    await waitFor(() =>
      expect(fake.store.record.mock.calls.at(-1)[0].at(-1)).toEqual({
        role: 'assistant',
        text: m.termi_history_import_summary({ n: 1, file: 'plan.xlsx' }),
        tier: 1
      })
    );
    const turns = fake.store.record.mock.calls.at(-1)[0];
    expect(turns.at(-2)).toEqual({ role: 'user', text: 'Nur Dezember', tier: 1 });
    expect(turns.at(-3)).toMatchObject({ role: 'assistant', text: 'Live-Antwort.', tier: 2 });
  });

  it('read-only restore turns stored show_pages ids into page buttons', async () => {
    fake.store = makeStore({
      id: 'c3',
      title: 'Kalender',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Wo ist der Kalender?', tier: 2 },
        {
          role: 'assistant',
          text: 'Hier:',
          tier: 2,
          toolParts: [
            {
              type: 'dynamic-tool',
              toolName: 'show_pages',
              toolCallId: 'p1',
              state: 'output-available',
              output: { ids: ['calendar', 'nope'] }
            }
          ]
        }
      ]
    });
    const view = renderWindow();
    await openStored(view);
    const box = await waitFor(() => view.getByTestId('termi-answer-actions'));
    const links = [...box.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/calendar');
  });

  it('a tier-1 answer arriving after an account switch is dropped, not recorded', async () => {
    /** @type {(r: Response) => void} */
    let answer = () => {};
    const base = /** @type {any} */ (globalThis.fetch);
    vi.stubGlobal(
      'fetch',
      vi.fn((/** @type {string} */ url, /** @type {RequestInit} */ init) =>
        url === '/api/termi/search' ? new Promise((r) => (answer = r)) : base(url, init)
      )
    );
    const view = renderWindow();
    await type(view, 'Finde Material zu Brüchen');
    await waitFor(() =>
      expect(
        /** @type {any} */ (globalThis.fetch).mock.calls.some(
          (/** @type {any[]} */ c) => c[0] === '/api/termi/search'
        )
      ).toBe(true)
    );
    loginEligible();
    answer(new Response(JSON.stringify({ items: [item(1)], sourcesUnavailable: [] })));
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryAllByTestId('termi-card-resource')).toHaveLength(0);
    expect(fake.store.record).not.toHaveBeenCalled();
  });
});
