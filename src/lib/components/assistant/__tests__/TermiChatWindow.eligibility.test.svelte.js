/**
 * The assistant's NIP-05 gate on the client: assistant skills route only when
 * /api/termi/eligible says `eligible: true` for the active pubkey (probed once
 * per pubkey); a 403 `not_eligible` from the chat route and an account switch
 * both drop back to router mode.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { _resetTermiEligibilityForTests } from '../termi-router.js';

overwriteGetLocale(() => 'de');

/** @param {Uint8Array} sk */
const nsecUser = (sk) => ({
  pubkey: getPublicKey(sk),
  type: 'nsec',
  signer: { signEvent: async (/** @type {any} */ draft) => finalizeEvent(draft, sk) }
});
const ALICE = nsecUser(generateSecretKey());
const BOB = nsecUser(generateSecretKey());

/** @type {any} */
let activeUser = $state.raw(ALICE);

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
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => activeUser }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

import TermiChatWindow from '../TermiChatWindow.svelte';

function streamAnswer() {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'text-start', id: 't1' });
        writer.write({ type: 'text-delta', id: 't1', delta: 'Hier sind Treffer.' });
        writer.write({ type: 'text-end', id: 't1' });
      }
    })
  });
}

/** @type {string[]} */
let probes;
/** @type {string[]} */
let chatCalls;

/**
 * @param {{
 *   eligible?: Record<string, boolean | null> | 'error',
 *   matches?: Array<{ skill: string, score: number }>,
 *   chat?: () => Response
 * }} opts
 */
function stubFetch({
  eligible = {},
  matches = [{ skill: 'assistant.search', score: 0.92 }],
  chat = streamAnswer
}) {
  probes = [];
  chatCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url) => {
      if (url === '/api/termi') return new Response(JSON.stringify({ matches }));
      if (url.startsWith('/api/termi/eligible')) {
        const pubkey = new URL(url, 'http://x').searchParams.get('pubkey') || '';
        probes.push(pubkey);
        if (eligible === 'error') return new Response('', { status: 500 });
        return new Response(JSON.stringify({ eligible: eligible[pubkey] ?? false, gated: true }));
      }
      chatCalls.push(url);
      return chat();
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

/** @param {ReturnType<typeof renderWindow>} view */
async function answerHrefs(view) {
  const boxes = await waitFor(() => view.getAllByTestId('termi-answer-actions'));
  return [...(boxes.at(-1)?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
}

describe('TermiChatWindow — assistant NIP-05 gate', () => {
  beforeEach(() => {
    activeUser = ALICE;
    _resetTermiEligibilityForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('not eligible → learning search link, no chat; the probe runs once per pubkey', async () => {
    stubFetch({ eligible: { [ALICE.pubkey]: false } });
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    // As for a readonly account: assistant.search is not offered, the plain search is.
    expect(await answerHrefs(view)).toContain('/discover?type=learning');
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(view.getAllByTestId('termi-answer-actions')).toHaveLength(2));
    expect(chatCalls).toEqual([]);
    expect(probes).toEqual([ALICE.pubkey]);
    expect(view.queryByText(m.termi_route_assistant())).toBeNull();
  });

  it.each([
    [{ [ALICE.pubkey]: null }, 'undetermined'],
    ['error', 'probe failed']
  ])('probe %o (%s) → not eligible for routing, no error shown', async (eligible) => {
    stubFetch({ eligible: /** @type {any} */ (eligible) });
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    expect(await answerHrefs(view)).toContain('/discover?type=learning');
    expect(chatCalls).toEqual([]);
    expect(view.queryByText(m.termi_assistant_error(), { exact: false })).toBeNull();
  });

  it('eligible → the assistant chat starts', async () => {
    stubFetch({ eligible: { [ALICE.pubkey]: true } });
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    expect(chatCalls).toEqual(['/api/termi/chat']);
  });

  it('chat 403 not_eligible → the members line plus the learning link, back to router mode', async () => {
    stubFetch({
      eligible: { [ALICE.pubkey]: true },
      chat: () => new Response(JSON.stringify({ error: 'not_eligible' }), { status: 403 })
    });
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_assistant_not_eligible(), { exact: false }));
    expect(await answerHrefs(view)).toEqual(['/discover?type=learning&search=Br%C3%BCchen']);
    expect(view.queryByText(m.termi_assistant_restart())).toBeNull();
    expect(view.getByText(m.termi_sugg_1_q())).toBeTruthy();
    // Remembered: the next question routes to the plain search without a chat call.
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => expect(view.getAllByTestId('termi-answer-actions')).toHaveLength(2));
    expect(chatCalls).toHaveLength(1);
  });

  it('an account switch while in assistant mode leaves assistant mode', async () => {
    stubFetch({ eligible: { [ALICE.pubkey]: true, [BOB.pubkey]: true } });
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_assistant_restart()));
    activeUser = BOB;
    await waitFor(() => expect(view.queryByText(m.termi_assistant_restart())).toBeNull());
    expect(view.queryByText('Hier sind Treffer.')).toBeNull();
    expect(view.getByText(m.termi_sugg_1_q())).toBeTruthy();
  });

  it('the "maybe" assistant button re-checks the account before starting', async () => {
    stubFetch({
      eligible: { [ALICE.pubkey]: true },
      matches: [
        { skill: 'assistant.search', score: 0.78 },
        { skill: 'search.learning', score: 0.76 }
      ]
    });
    const view = renderWindow();
    await type(view, 'Materialien Brüche?');
    const button = await waitFor(() => view.getByText(m.termi_route_assistant()));
    activeUser = { pubkey: ALICE.pubkey, type: 'readonly' };
    await fireEvent.click(button);
    await waitFor(() => view.getByText(m.termi_assistant_unavailable(), { exact: false }));
    expect(chatCalls).toEqual([]);
    expect(view.queryByText(m.termi_assistant_restart())).toBeNull();
  });

  it('the "maybe" assistant button re-checks eligibility for a switched account', async () => {
    stubFetch({
      eligible: { [ALICE.pubkey]: true, [BOB.pubkey]: false },
      matches: [
        { skill: 'assistant.search', score: 0.78 },
        { skill: 'search.learning', score: 0.76 }
      ]
    });
    const view = renderWindow();
    await type(view, 'Materialien Brüche?');
    const button = await waitFor(() => view.getByText(m.termi_route_assistant()));
    activeUser = BOB;
    await fireEvent.click(button);
    await waitFor(() => view.getByText(m.termi_assistant_not_eligible(), { exact: false }));
    expect(chatCalls).toEqual([]);
    expect(probes).toEqual([ALICE.pubkey, BOB.pubkey]);
  });
});
