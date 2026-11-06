/** @vitest-environment jsdom */
// Assistant mode (TERMI_AI_ENABLED + LLM + logged in): a confident
// `assistant.search` decision starts an AI chat against /api/termi/chat with
// the user's text; later input goes to the chat until "Neu anfangen".
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

const HITS = [
  { title: 'Brüche verstehen', url: 'https://example.org/1', license: 'CC BY 4.0' },
  { title: 'Bruchrechnen üben', url: 'https://example.org/2' }
];

/** A finished assistant turn: a search_resources call plus a text answer. */
function streamAnswer({ toolName = 'search_resources', text = 'Hier sind Treffer.' } = {}) {
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
        writer.write({ type: 'tool-output-available', toolCallId: 'c1', output: { hits: HITS } });
        writer.write({ type: 'finish-step' });
        writer.write({ type: 'text-start', id: 't1' });
        writer.write({ type: 'text-delta', id: 't1', delta: text });
        writer.write({ type: 'text-end', id: 't1' });
      }
    })
  });
}

/** @type {Array<{ url: string, init: RequestInit }>} */
let chatCalls;

/** @param {() => Response | Promise<Response>} chatAnswer */
function stubFetch(chatAnswer, skill = 'assistant.search') {
  chatCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
      if (url === '/api/termi') {
        return new Response(JSON.stringify({ matches: [{ skill, score: 0.92 }] }));
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

  it('assistant.search starts the chat with the user text, signed over the sent body', async () => {
    stubFetch(() => streamAnswer());
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(view.getAllByTestId('termi-hit')).toHaveLength(2));
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    // The question shows once, not as router bubble + chat bubble.
    expect(view.getAllByText('Finde Materialien zu Brüchen')).toHaveLength(1);

    expect(chatCalls).toHaveLength(1);
    const { url, init } = chatCalls[0];
    expect(url).toBe('/api/termi/chat');
    const body = /** @type {string} */ (init.body);
    const parsed = JSON.parse(body);
    expect(parsed.task).toBe('search');
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
    expect(view.queryAllByTestId('termi-hit')).toHaveLength(0);
    // Back in router mode: the canned chips are back and new text goes to /api/termi.
    expect(view.getByText(m.termi_sugg_1_q())).toBeTruthy();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(chatCalls).toHaveLength(3));
  });

  it('other tool parts render nothing', async () => {
    stubFetch(() => streamAnswer({ toolName: 'something_else' }));
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    expect(view.queryAllByTestId('termi-hit')).toHaveLength(0);
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
  });

  it('message list is a polite live log; static notice replaced with the flag on', async () => {
    stubFetch(() => streamAnswer());
    const view = renderWindow();
    const log = view.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(view.queryByText(m.termi_static_notice())).toBeNull();
  });
});
