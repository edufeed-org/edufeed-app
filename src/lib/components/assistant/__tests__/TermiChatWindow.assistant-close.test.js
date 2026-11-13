/** @vitest-environment jsdom */
// Closing Termi while the assistant chat chunk is still loading must not
// sign or send anything once the chunk arrives. Own file: the chunk is held
// open by a vi.mock factory, which runs once per file.
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const SK = generateSecretKey();
const user = {
  pubkey: getPublicKey(SK),
  type: 'nsec',
  signer: { signEvent: vi.fn(async (/** @type {any} */ draft) => finalizeEvent(draft, SK)) }
};

/** @returns {{ promise: Promise<void>, resolve: () => void }} */
function deferred() {
  /** @type {() => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = /** @type {() => void} */ (r)));
  return { promise, resolve };
}
const gate = vi.hoisted(() => ({
  started: /** @type {{ promise: Promise<void>, resolve: () => void } | null} */ (null),
  release: /** @type {{ promise: Promise<void>, resolve: () => void } | null} */ (null)
}));
gate.started = deferred();
gate.release = deferred();

vi.mock('../termi-chat.svelte.js', async () => {
  gate.started?.resolve();
  await gate.release?.promise;
  return vi.importActual('../termi-chat.svelte.js');
});

termiEnv.user = user;

import TermiChatWindow from '../TermiChatWindow.svelte';

describe('TermiChatWindow assistant start after close', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('closing the window while the chat module loads sends nothing', async () => {
    /** @type {string[]} */
    const chatCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (/** @type {string} */ url) => {
        if (url.startsWith('/api/termi/eligible')) {
          return new Response(JSON.stringify({ eligible: true, gated: true }));
        }
        if (url === '/api/termi') {
          return new Response(JSON.stringify({ matches: [] }));
        }
        chatCalls.push(url);
        return new Response('', { status: 500 });
      })
    );
    const view = render(TermiChatWindow, { props: windowProps() });
    await fireEvent.input(view.getByTestId('termi-input'), {
      target: { value: 'Finde Materialien zu Brüchen' }
    });
    await fireEvent.click(view.getByTestId('termi-send'));

    // The chunk import has started and is held open.
    await gate.started?.promise;
    view.unmount();
    gate.release?.resolve();

    // Give a (wrong) start every chance to sign and send.
    await new Promise((r) => setTimeout(r, 200));
    await waitFor(() => expect(chatCalls).toEqual([]));
    expect(user.signer.signEvent).not.toHaveBeenCalled();
  });
});
