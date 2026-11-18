/** @vitest-environment jsdom */
// The window's link kit keeps its identity while the allowed targets stay the same (a streamed
// token must not re-render every bubble), changes when a tool result adds a target, and every
// in-app anchor (text, card, action) goes through the host while the Werkbank steps aside.
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const markdownCalls = vi.hoisted(() => /** @type {string[]} */ ([]));
vi.mock('$lib/helpers/markdown.js', async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
    renderMarkdown: (/** @type {string} */ md, /** @type {any} */ o) => {
      markdownCalls.push(md);
      return real.renderMarkdown(md, o);
    }
  };
});

termiEnv.getUser = () => ({
  pubkey: 'a'.repeat(64),
  type: 'nsec',
  signer: { signEvent: async (/** @type {any} */ d) => ({ ...d, id: 'x', sig: 'y', pubkey: 'a' }) }
});
termiEnv.config.termi = { enabled: true, embed: true, llm: true };

import TermiChatWindow from '../TermiChatWindow.svelte';

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** @param {{ items?: any[], deltas: string[] }} o */
const answer = ({ items, deltas }) =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        if (items) {
          writer.write({ type: 'start-step' });
          writer.write({
            type: 'tool-input-available',
            toolCallId: 'c1',
            toolName: 'search_content',
            input: { query: 'x' }
          });
          writer.write({
            type: 'tool-output-available',
            toolCallId: 'c1',
            output: { items, sourcesUnavailable: [] }
          });
          writer.write({ type: 'finish-step' });
        }
        writer.write({ type: 'text-start', id: 't1' });
        for (const delta of o(deltas)) {
          writer.write({ type: 'text-delta', id: 't1', delta });
          await wait(15);
        }
        writer.write({ type: 'text-end', id: 't1' });
      }
    })
  });
const o = (/** @type {string[]} */ x) => x;

/** @param {Array<() => Response>} answers */
function stubFetch(answers) {
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url) => {
      if (url.startsWith('/api/termi/eligible'))
        return new Response(JSON.stringify({ eligible: true, gated: true }));
      if (url === '/api/termi') return new Response(JSON.stringify({ matches: [] }));
      if (url === '/api/termi/search')
        return new Response(JSON.stringify({ items: [], sourcesUnavailable: [] }));
      if (url.endsWith('/api/termi/models')) return new Response('', { status: 404 });
      return answers[n++]();
    })
  );
}
/** @param {any} view @param {string} text @param {string} last the answer's last words */
async function type(view, text, last) {
  await fireEvent.input(view.getByTestId('termi-input'), { target: { value: text } });
  await fireEvent.click(view.getByTestId('termi-send'));
  await waitFor(() => expect(view.container.textContent).toContain(last), { timeout: 5000 });
  await waitFor(() => expect(view.getByTestId('termi-send').hasAttribute('disabled')).toBe(false));
}

const ONE = { type: 'resource', id: '30142:pk:1', title: 'Eins', href: '/naddr1one' };
const TWO = { type: 'resource', id: '30142:pk:2', title: 'Zwei', href: '/naddr1two' };

describe('TermiChatWindow link kit', () => {
  beforeEach(() => {
    markdownCalls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('streamed tokens do not re-render finished bubbles; a new target makes an earlier link clickable', async () => {
    stubFetch([
      () => answer({ items: [ONE], deltas: ['Erste Antwort ', 'mit [Zwei](/naddr1two).'] }),
      () => answer({ deltas: ['Zweite Antwort.'] }),
      () => answer({ deltas: Array.from({ length: 12 }, (_, i) => `Wort${i} `) }),
      () => answer({ items: [TWO], deltas: ['Vierte.'] })
    ]);
    const view = render(TermiChatWindow, { props: windowProps() });
    await type(view, 'Frage eins', 'Zwei');
    await type(view, 'Frage zwei', 'Zweite Antwort.');
    // not clickable yet: nothing of this chat holds /naddr1two
    expect(view.container.querySelector('a[href="/naddr1two"]')).toBeNull();
    markdownCalls.length = 0;
    await type(view, 'Frage drei', 'Wort11');
    expect(markdownCalls.filter((t) => t.includes('Erste Antwort')).length).toBeLessThanOrEqual(1);
    expect(markdownCalls.filter((t) => t.includes('Zweite Antwort')).length).toBeLessThanOrEqual(1);
    await type(view, 'Frage vier', 'Vierte.');
    await waitFor(() => expect(view.container.querySelector('a[href="/naddr1two"]')).toBeTruthy());
  });
});

describe('TermiChatWindow in-app anchors in the Werkbank', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** @param {() => Promise<any>} setup */
  async function clickIn(setup) {
    const navigate = vi.fn();
    const onWorkbench = vi.fn();
    const view = render(TermiChatWindow, {
      props: {
        ...windowProps(),
        workbench: true,
        onWorkbench,
        host: { navigate, actions: () => [] }
      }
    });
    const a = await setup().then(() => view);
    return { view: a, navigate, onWorkbench };
  }

  it('a card link goes through the host and the Werkbank steps aside; a modifier click does not', async () => {
    stubFetch([() => answer({ items: [ONE], deltas: ['Treffer.'] })]);
    const { view, navigate, onWorkbench } = await clickIn(async () => {});
    await type(view, 'Frage', 'Treffer.');
    const link = await waitFor(() => view.getByText(m.termi_card_open()));
    onWorkbench.mockClear();
    await fireEvent.click(link, { ctrlKey: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(onWorkbench).not.toHaveBeenCalled();
    await fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/naddr1one');
    expect(onWorkbench).toHaveBeenCalledWith(false);
  });

  it('a button-link of a canned answer does the same', async () => {
    termiEnv.config.termi = { enabled: false };
    termiEnv.config.discover = { contentTypes: ['learning'] };
    const { view, navigate, onWorkbench } = await clickIn(async () => {});
    await fireEvent.click(view.getByText(m.termi_sugg_2_q()));
    const link = await waitFor(() => view.getByTestId('termi-help-link'), { timeout: 3000 });
    await fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith(link.getAttribute('href'));
    expect(onWorkbench).toHaveBeenCalledWith(false);
  });
});

describe('TermiChatWindow full view', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the side panel offers the full view; the popover does not', async () => {
    const onToggleFull = vi.fn();
    const pop = render(TermiChatWindow, { props: { ...windowProps(), onToggleFull } });
    expect(pop.queryByTestId('termi-full')).toBeNull();
    pop.unmount();
    const side = render(TermiChatWindow, {
      props: { ...windowProps(), expanded: true, onToggleFull }
    });
    await fireEvent.click(side.getByTestId('termi-full'));
    expect(onToggleFull).toHaveBeenCalledOnce();
  });

  it('Escape steps back to the side panel instead of closing', async () => {
    const onToggleFull = vi.fn();
    const onClose = vi.fn();
    const view = render(TermiChatWindow, {
      props: { ...windowProps(), full: true, onToggleFull, onClose }
    });
    await fireEvent.keyDown(view.getByTestId('termi-full'), { key: 'Escape' });
    expect(onToggleFull).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a card link opens in a new tab, the chat stays', async () => {
    termiEnv.config.termi = { enabled: true, embed: true, llm: true }; // the test above turned it off
    stubFetch([() => answer({ items: [ONE], deltas: ['Treffer.'] })]);
    const navigate = vi.fn();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const view = render(TermiChatWindow, {
      props: { ...windowProps(), full: true, host: { navigate, actions: () => [] } }
    });
    await type(view, 'Frage', 'Treffer.');
    await fireEvent.click(await waitFor(() => view.getByText(m.termi_card_open())));
    expect(open).toHaveBeenCalledWith('/naddr1one', '_blank', 'noopener');
    expect(navigate).not.toHaveBeenCalled();
  });
});
