/**
 * Account-switch wiring: a reactive active user drives the window's effects
 * (the chat ends, a waiting attachment goes). The NIP-05 gate itself (probe
 * once per pubkey, 403, switch during the probe) is tested on the controller:
 * termi-conversation.test.js.
 *
 * @vitest-environment jsdom
 */
import { termiEnv, windowProps } from './termi-window-setup.js';
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
termiEnv.getUser = () => activeUser;

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
function stubFetch({ eligible = {}, matches = [], chat = streamAnswer }) {
  probes = [];
  chatCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url) => {
      if (url === '/api/termi') return new Response(JSON.stringify({ matches }));
      if (url === '/api/termi/search') {
        return new Response(JSON.stringify({ items: [], sourcesUnavailable: [] }));
      }
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
  return render(TermiChatWindow, { props: windowProps() });
}

/** @param {ReturnType<typeof renderWindow>} view @param {string} text */
async function type(view, text) {
  await fireEvent.input(view.getByTestId('termi-input'), { target: { value: text } });
  await fireEvent.click(view.getByTestId('termi-send'));
}

describe('TermiChatWindow — assistant NIP-05 gate', () => {
  beforeEach(() => {
    activeUser = ALICE;
    _resetTermiEligibilityForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('an account switch while in assistant mode leaves assistant mode', async () => {
    stubFetch({ eligible: { [ALICE.pubkey]: true, [BOB.pubkey]: true } });
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_history_new()));
    activeUser = BOB;
    await waitFor(() => expect(view.queryByText(m.termi_history_new())).toBeNull());
    expect(view.queryByText('Hier sind Treffer.')).toBeNull();
    expect(view.getByText(m.termi_sugg_1_q())).toBeTruthy();
  });

  it('a logout drops a waiting attachment chip', async () => {
    stubFetch({ eligible: { [ALICE.pubkey]: true } });
    const view = renderWindow();
    await fireEvent.drop(view.getByTestId('termi-window'), {
      dataTransfer: { files: [new File(['xx'], 'plan.xlsx')], types: ['Files'] }
    });
    await waitFor(() => view.getByTestId('termi-attachment'));
    activeUser = null;
    await waitFor(() => expect(view.queryByTestId('termi-attachment')).toBeNull());
  });
});
