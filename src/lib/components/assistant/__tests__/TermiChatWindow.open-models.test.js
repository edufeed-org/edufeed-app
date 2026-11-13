/** @vitest-environment jsdom */
// The real controller: the model button is there when the window opens (unsigned list), the menu
// loads the signed list (outside group for a listed account), and the first slow start shows the
// wait card with the model's name.
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

overwriteGetLocale(() => 'de');

const SK = generateSecretKey();
const signEvent = vi.fn(async (/** @type {any} */ draft) => finalizeEvent(draft, SK));
const user = { pubkey: getPublicKey(SK), type: 'nsec', signer: { signEvent } };
termiEnv.getUser = () => user;

import TermiChatWindow from '../TermiChatWindow.svelte';

const LIST = {
  default: 'saia:glm-5.3',
  models: [
    { id: 'saia:glm-5.3', name: 'GLM 5.3', state: 'ready' },
    { id: 'saia:llama', name: 'Llama 4', state: 'ready' }
  ]
};
const SIGNED = {
  ...LIST,
  external: {
    models: [{ id: 'anthropic:claude-opus-5-5', name: 'Claude Opus 5.5' }],
    left: 9,
    total: 20
  }
};

/** @type {Array<{ url: string, init?: RequestInit }>} */
let calls;
beforeEach(() => {
  termiEnv.config.termi = { enabled: true, embed: true, llm: true };
  signEvent.mockClear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
      calls.push({ url, init });
      if (url.startsWith('/api/termi/eligible'))
        return new Response(JSON.stringify({ eligible: true, gated: true }));
      if (url.endsWith('/api/termi/models'))
        return new Response(JSON.stringify(init?.method === 'POST' ? SIGNED : LIST));
      if (url === '/api/termi') return new Response(JSON.stringify({ matches: [] }));
      // the chat: a provider that never starts
      return new Response(new ReadableStream({ start() {} }), {
        headers: { 'content-type': 'text/event-stream' }
      });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const signedModelCalls = () =>
  calls.filter((c) => c.url.endsWith('/api/termi/models') && c.init?.method === 'POST');

describe('model list on open', () => {
  it('the button is there before any message, and nothing was signed', async () => {
    const view = render(TermiChatWindow, { props: windowProps() });
    const button = await view.findByTestId('termi-model-button');
    expect(button.textContent).toContain('Antwort von SAIA (GWDG) · GLM 5.3');
    expect(signEvent).not.toHaveBeenCalled();
    expect(signedModelCalls()).toHaveLength(0);
  });

  it('opening the menu loads the signed list: a listed account sees the outside group', async () => {
    const view = render(TermiChatWindow, { props: windowProps() });
    await fireEvent.click(await view.findByTestId('termi-model-button'));
    expect(view.queryByText(m.termi_outside_group_title())).toBeNull();
    await waitFor(() => expect(signedModelCalls()).toHaveLength(1));
    const menu = await view.findByRole('menu');
    await waitFor(() => within(menu).getByText(m.termi_outside_group_title()));
    expect(within(menu).getByText('Claude Opus 5.5')).toBeTruthy();
  });

  it("the first question's slow start shows the wait card with the model's name", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = render(TermiChatWindow, { props: windowProps() });
    await view.findByTestId('termi-model-button');
    await fireEvent.input(view.getByTestId('termi-input'), {
      target: { value: 'Finde Materialien zu Brüchen' }
    });
    await fireEvent.click(view.getByTestId('termi-send'));
    await waitFor(() => view.getByTestId('termi-stop'));
    await vi.advanceTimersByTimeAsync(9_000);
    const card = await view.findByTestId('termi-wait');
    expect(card.textContent).toContain(m.termi_wait_title({ model: 'GLM 5.3' }));
    expect(card.textContent).toContain('Llama 4');
  });
});
