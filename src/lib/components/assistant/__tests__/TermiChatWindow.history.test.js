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

const TIER2_CONV = {
  id: 'c2',
  title: 'Brüche',
  createdAt: 1,
  updatedAt: 1,
  turns: [
    { role: 'user', text: 'Finde Brüche', tier: 2 },
    {
      role: 'assistant',
      text: 'Drei Treffer.',
      tier: 2,
      toolParts: [
        {
          type: 'dynamic-tool',
          toolName: 'search_content',
          toolCallId: 'k1',
          state: 'output-available',
          input: { query: 'Brüche' },
          output: { items: [item(1), item(2), item(3)], sourcesUnavailable: [] }
        }
      ]
    }
  ]
};

/** @type {Array<{ url: string, init: RequestInit }>} */
let chatCalls;

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
        return streamText();
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
async function openStored(view) {
  await waitFor(() => view.getByTestId('termi-history-toggle'));
  await fireEvent.click(view.getByTestId('termi-history-toggle'));
  await fireEvent.click(view.getByTestId('termi-history-row'));
  await waitFor(() => expect(view.queryByTestId('termi-history')).toBeNull());
}

describe('TermiChatWindow history', () => {
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

  it('a stored tier-2 conversation opens read-only without an assistant: text plus 3 cards', async () => {
    fake.store = makeStore(TIER2_CONV);
    const view = renderWindow();
    await openStored(view);
    expect(view.getByText('Finde Brüche')).toBeTruthy();
    expect(view.getByText('Drei Treffer.')).toBeTruthy();
    expect(view.getAllByTestId('termi-card-resource')).toHaveLength(3);
  });

  it('with a running chat the tier-2 turns become its messages, tool part included', async () => {
    fake.store = makeStore(TIER2_CONV);
    loginEligible();
    const view = renderWindow();
    await type(view, 'Erste Frage');
    await waitFor(() => view.getByText('Live-Antwort.'));
    await waitFor(() =>
      expect(/** @type {HTMLButtonElement} */ (view.getByTestId('termi-send')).disabled).toBe(false)
    );
    await openStored(view);
    expect(view.queryByText('Erste Frage')).toBeNull();
    expect(view.getAllByText('Finde Brüche')).toHaveLength(1);
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(3));

    // A follow-up continues the restored context.
    await type(view, 'Nur Klasse 6');
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    const sent = JSON.parse(String(chatCalls[1].init.body)).messages;
    expect(sent.map((/** @type {any} */ x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[1].parts[0]).toMatchObject({ type: 'dynamic-tool', toolName: 'search_content' });
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
    await waitFor(() => view.getByTestId('termi-import-send'));
    await fireEvent.click(view.getByTestId('termi-import-send'));
    await waitFor(() => view.getByText(m.termi_import_publish({ n: 1 })));
    expect(fake.store.record).not.toHaveBeenCalled();
    await fireEvent.click(view.getByText(m.termi_import_publish({ n: 1 })));
    await waitFor(() => expect(fake.store.record).toHaveBeenCalled());
    const turns = fake.store.record.mock.calls.at(-1)[0];
    expect(turns).toEqual([
      {
        role: 'assistant',
        text: m.termi_history_import_summary({ n: 1, file: 'plan.xlsx' }),
        tier: 1
      }
    ]);
  });
});
