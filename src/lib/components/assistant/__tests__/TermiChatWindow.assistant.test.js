/** @vitest-environment jsdom */
// Assistant mode (TERMI_AI_ENABLED + LLM + a signing, eligible account): a
// content question (no confident navigate/create/help skill) starts an AI
// chat (task `ask`) against /api/termi/chat with the user's text; later input
// goes to the chat until "Neu anfangen".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { verifyNip98Header } from '$lib/server/nip98-verify.js';

overwriteGetLocale(() => 'de');

const SK = generateSecretKey();
const user = vi.hoisted(() => ({
  current: /** @type {any} */ (null)
}));
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
  {
    type: 'resource',
    id: '30142:pk:1',
    title: 'Brüche verstehen',
    href: '/naddr1one',
    license: 'CC BY 4.0'
  },
  { type: 'resource', id: '30142:pk:2', title: 'Bruchrechnen üben', href: '/naddr1two' }
];

/** A finished assistant turn: a search_content call plus a text answer. */
function streamAnswer({
  toolName = 'search_content',
  text = 'Hier sind Treffer.',
  sourcesUnavailable = /** @type {string[]} */ ([])
} = {}) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start-step' });
        writer.write({
          type: 'tool-input-available',
          toolCallId: 'c1',
          toolName,
          input: { query: 'Brüche' }
        });
        writer.write({
          type: 'tool-output-available',
          toolCallId: 'c1',
          output: { items: ITEMS, sourcesUnavailable }
        });
        writer.write({ type: 'finish-step' });
        writer.write({ type: 'text-start', id: 't1' });
        writer.write({ type: 'text-delta', id: 't1', delta: text });
        writer.write({ type: 'text-end', id: 't1' });
      }
    })
  });
}

/** The NIP-05 gate's probe says yes (the gate itself: TermiChatWindow.eligibility). */
const eligibleAnswer = () => new Response(JSON.stringify({ eligible: true, gated: true }));

/** @type {Array<{ url: string, init: RequestInit }>} */
let chatCalls;

/** @param {() => Response | Promise<Response>} chatAnswer */
function stubFetch(chatAnswer) {
  chatCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
      if (url.startsWith('/api/termi/eligible')) return eligibleAnswer();
      // No skill fits a content question: the router hands it to the content path.
      if (url === '/api/termi') return new Response(JSON.stringify({ matches: [] }));
      if (url === '/api/termi/search') {
        return new Response(JSON.stringify({ items: [], sourcesUnavailable: [] }));
      }
      chatCalls.push({ url, init });
      return chatAnswer();
    })
  );
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

describe('TermiChatWindow assistant mode', () => {
  beforeEach(() => {
    mockConfig.termi = { enabled: true, embed: true, llm: true };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a content question starts the chat with the user text, signed over the sent body', async () => {
    stubFetch(() => streamAnswer());
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    // The question shows once, not as router bubble + chat bubble.
    expect(view.getAllByText('Finde Materialien zu Brüchen')).toHaveLength(1);

    expect(chatCalls).toHaveLength(1);
    const { url, init } = chatCalls[0];
    expect(url).toBe('/api/termi/chat');
    const body = /** @type {string} */ (init.body);
    const parsed = JSON.parse(body);
    expect(parsed.task).toBe('ask');
    expect(parsed.messages.at(-1).parts[0].text).toBe('Finde Materialien zu Brüchen');
    // The transport lower-cases header names.
    const auth = /** @type {Record<string, string>} */ (init.headers).authorization;
    expect(
      await verifyNip98Header(auth, new URL('/api/termi/chat', location.origin).href, 'POST', body)
    ).toBe(user.current.pubkey);
  });

  it('later input goes to the chat; "Neu anfangen" returns to router mode', async () => {
    stubFetch(() => streamAnswer());
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(chatCalls).toHaveLength(1));
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    // The send button is off while an answer streams; typing is not.
    await waitFor(() =>
      expect(/** @type {HTMLButtonElement} */ (view.getByTestId('termi-send')).disabled).toBe(false)
    );
    await type(view, 'Nur für Klasse 6');
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    const second = JSON.parse(/** @type {string} */ (chatCalls[1].init.body));
    expect(second.messages.filter((/** @type {any} */ x) => x.role === 'user')).toHaveLength(2);

    await waitFor(() => view.getByText(m.termi_assistant_restart()));
    await fireEvent.click(view.getByText(m.termi_assistant_restart()));
    expect(view.queryAllByTestId('termi-card-resource')).toHaveLength(0);
    // Back in router mode: the canned chips are back and new text goes to /api/termi.
    expect(view.getByText(m.termi_sugg_1_q())).toBeTruthy();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(chatCalls).toHaveLength(3));
  });

  it.each(['search_events', 'find_people'])('%s results render as cards', async (toolName) => {
    stubFetch(() => streamAnswer({ toolName }));
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(2));
    expect(view.getAllByText(m.termi_card_open())[0].getAttribute('href')).toBe('/naddr1one');
  });

  it('a tool reporting an unreachable source shows the note; retry regenerates', async () => {
    stubFetch(() => streamAnswer({ sourcesUnavailable: ['search_events'] }));
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_sources_events()));
    await waitFor(() =>
      expect(/** @type {HTMLButtonElement} */ (view.getByTestId('termi-send')).disabled).toBe(false)
    );
    await fireEvent.click(view.getByText(m.termi_sources_retry()));
    await waitFor(() => expect(chatCalls).toHaveLength(2));
  });

  it('other tool parts render nothing', async () => {
    stubFetch(() => streamAnswer({ toolName: 'something_else' }));
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    expect(view.queryAllByTestId('termi-card-resource')).toHaveLength(0);
  });

  it('HTTP 429 → quota line plus the learning search link', async () => {
    stubFetch(
      () => new Response(JSON.stringify({ error: 'quota', scope: 'user' }), { status: 429 })
    );
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_quota(), { exact: false }));
    const link = view.getByText(m.termi_quota_link());
    expect(link.getAttribute('href')).toBe('/discover?type=learning&search=Br%C3%BCchen');
  });

  it.each([[{ error: 'quota', scope: 'global' }, 'global monthly cap']])(
    'HTTP 429 %o → the non-daily quota line plus the learning search link (%s)',
    async (body, _label) => {
      stubFetch(() => new Response(JSON.stringify(body), { status: 429 }));
      const view = renderWindow();
      await type(view, 'Finde Materialien zu Brüchen');
      await waitFor(() => view.getByText(m.termi_quota_global(), { exact: false }));
      expect(view.queryByText(m.termi_quota(), { exact: false })).toBeNull();
      expect(view.getByText(m.termi_quota_link()).getAttribute('href')).toBe(
        '/discover?type=learning&search=Br%C3%BCchen'
      );
    }
  );

  it('a readonly (npub) account gets no assistant: the learning search link instead', async () => {
    const real = user.current;
    user.current = { pubkey: real.pubkey, type: 'readonly' };
    try {
      stubFetch(() => streamAnswer());
      const view = renderWindow();
      await type(view, 'Finde Materialien zu Brüchen');
      const box = await waitFor(() => view.getByTestId('termi-answer-actions'));
      const hrefs = [...box.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/discover?type=learning');
      expect(chatCalls).toHaveLength(0);
    } finally {
      user.current = real;
    }
  });

  it('HTTP 503 → short line, learning search link, back to router mode', async () => {
    stubFetch(() => new Response('{}', { status: 503 }));
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_assistant_unavailable(), { exact: false }));
    const box = view.getByTestId('termi-answer-actions');
    expect(box.querySelector('a')?.getAttribute('href')).toBe(
      '/discover?type=learning&search=Br%C3%BCchen'
    );
    expect(view.getByText(m.termi_sugg_1_q())).toBeTruthy();
    expect(view.queryByText(m.termi_assistant_restart())).toBeNull();
  });

  it('signer rejection → retry button, the user text kept', async () => {
    const signEvent = vi.fn(async () => Promise.reject(new Error('denied')));
    const realSigner = user.current.signer;
    user.current.signer = { signEvent };
    try {
      stubFetch(() => streamAnswer());
      const view = renderWindow();
      await type(view, 'Finde Materialien zu Brüchen');
      const retry = await waitFor(() => view.getByText(m.termi_assistant_retry()));
      expect(view.getByText(m.termi_assistant_error(), { exact: false })).toBeTruthy();
      expect(view.getByText('Finde Materialien zu Brüchen')).toBeTruthy();
      expect(chatCalls).toHaveLength(0);

      user.current.signer = realSigner;
      await fireEvent.click(retry);
      await waitFor(() => view.getByText('Hier sind Treffer.'));
      expect(chatCalls).toHaveLength(1);
    } finally {
      user.current.signer = realSigner;
    }
  });

  it('a stream error shows the retry line', async () => {
    stubFetch(() =>
      createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => writer.write({ type: 'error', errorText: 'termi:upstream' })
        })
      })
    );
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_assistant_retry()));
    // A way out to the plain search, too.
    expect(view.getByText(m.termi_quota_link()).getAttribute('href')).toBe(
      '/discover?type=learning&search=Br%C3%BCchen'
    );
  });

  it('a failed search without model text → a short note plus the learning search link', async () => {
    stubFetch(() =>
      createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: 'start-step' });
            writer.write({
              type: 'tool-input-available',
              toolCallId: 'c1',
              toolName: 'search_resources',
              input: { query: 'Brüche' }
            });
            writer.write({
              type: 'tool-output-error',
              toolCallId: 'c1',
              errorText: 'termi:upstream'
            });
            writer.write({ type: 'finish-step' });
          }
        })
      })
    );
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_search_failed(), { exact: false }));
    expect(view.getByText(m.termi_quota_link()).getAttribute('href')).toBe(
      '/discover?type=learning&search=Br%C3%BCchen'
    );
    expect(view.queryByText(m.termi_assistant_retry())).toBeNull();
  });

  it('trims leading/trailing blank lines from the model text (seen with qwen)', async () => {
    stubFetch(() => streamAnswer({ text: '\n\nHallo' }));
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    // Default exact match (RTL's own normalizer would hide the bug); the
    // greeting bubble's longer text does not match "Hallo" exactly.
    const bubble = await waitFor(() => view.getByText('Hallo'));
    expect(bubble.textContent).toBe('Hallo');
  });

  it('message list is a polite live log; static notice replaced with the flag on', async () => {
    stubFetch(() => streamAnswer());
    const view = renderWindow();
    const log = view.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(view.queryByText(m.termi_static_notice())).toBeNull();
  });
});
