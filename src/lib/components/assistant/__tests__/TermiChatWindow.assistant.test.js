/** @vitest-environment jsdom */
// Assistant mode (TERMI_AI_ENABLED + LLM + a signing, eligible account): a
// content question (no confident navigate/create/help skill) starts an AI
// chat (task `ask`) against /api/termi/chat with the user's text; later input
// goes to the chat until "Neu anfangen".
import { termiEnv, windowProps } from './termi-window-setup.js';
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

termiEnv.getUser = () => user.current;
const mockConfig = termiEnv.config;

const createArticle = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/article-actions.svelte.js', () => ({ createArticle }));

import TermiChatWindow from '../TermiChatWindow.svelte';
import { takeArticlePrefill } from '../document-export.js';

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

/**
 * A finished assistant turn: knowledge tool calls (default one search_content) plus a text answer.
 * @param {{ toolName?: string, text?: string, sourcesUnavailable?: string[],
 *   calls?: Array<{ toolName: string, items: any[], sourcesUnavailable: string[], input?: any }> }} [opts]
 */
function streamAnswer({
  toolName = 'search_content',
  text = 'Hier sind Treffer.',
  sourcesUnavailable = /** @type {string[]} */ ([]),
  calls = [{ toolName, items: ITEMS, sourcesUnavailable }]
} = {}) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        calls.forEach((call, i) => {
          writer.write({ type: 'start-step' });
          writer.write({
            type: 'tool-input-available',
            toolCallId: `c${i + 1}`,
            toolName: call.toolName,
            input: call.input ?? { query: i === 0 ? 'Brüche' : `Brüche ${i}` }
          });
          writer.write({
            type: 'tool-output-available',
            toolCallId: `c${i + 1}`,
            output: { items: call.items, sourcesUnavailable: call.sourcesUnavailable }
          });
          writer.write({ type: 'finish-step' });
        });
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
  return render(TermiChatWindow, { props: windowProps() });
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
    const d = new Date();
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    expect(parsed.today).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    expect(parsed.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
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

    await waitFor(() => view.getByText(m.termi_history_new()));
    await fireEvent.click(view.getByText(m.termi_history_new()));
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

  it('only the latest answer offers a retry; cards link "Alle anzeigen" with the tool query', async () => {
    stubFetch(() => streamAnswer({ sourcesUnavailable: ['search_events'] }));
    const view = renderWindow();
    const idle = () =>
      waitFor(() =>
        expect(/** @type {HTMLButtonElement} */ (view.getByTestId('termi-send')).disabled).toBe(
          false
        )
      );
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_sources_events()));
    await idle();
    await type(view, 'Und für Klasse 6?');
    await waitFor(() => expect(view.getAllByText(m.termi_sources_events())).toHaveLength(2));
    await idle();
    expect(view.getAllByText(m.termi_sources_retry())).toHaveLength(1);
    const all = view.getAllByText(
      m.termi_card_all({ type: m.discover_tab_learning(), topic: 'Brüche' })
    );
    expect(all[0].closest('a')?.getAttribute('href')).toBe(
      '/discover?type=learning&search=Br%C3%BCche'
    );
  });

  it('several knowledge tool calls in one answer render each card once, one fold row', async () => {
    const more = [3, 4, 5, 6, 7].map((n) => ({
      type: 'resource',
      id: `30142:pk:${n}`,
      title: `Treffer ${n}`,
      href: `/naddr1x${n}`
    }));
    stubFetch(() =>
      streamAnswer({
        calls: [
          {
            toolName: 'search_content',
            items: [...ITEMS, ...more.slice(0, 2)],
            sourcesUnavailable: []
          },
          {
            toolName: 'search_resources',
            items: [ITEMS[1], ...more],
            sourcesUnavailable: ['search_events']
          },
          { toolName: 'search_passages', items: [ITEMS[0]], sourcesUnavailable: ['search_events'] }
        ]
      })
    );
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    // 7 distinct items, folded at 6: each title once, one "more" row, one sources note.
    expect(view.getAllByTestId('termi-card-resource')).toHaveLength(6);
    expect(view.getAllByText('Brüche verstehen')).toHaveLength(1);
    expect(view.getAllByText(m.termi_cards_more({ n: 4 }))).toHaveLength(1);
    expect(view.getAllByText(m.termi_sources_events())).toHaveLength(1);
    // "Alle anzeigen" uses the first tool call's query.
    expect(
      view.getAllByText(m.termi_card_all({ type: m.discover_tab_learning(), topic: 'Brüche' }))
    ).toHaveLength(1);
  });

  it('"Alle anzeigen" takes the first call that has a query (find_people has a name)', async () => {
    stubFetch(() =>
      streamAnswer({
        calls: [
          { toolName: 'find_people', input: { name: 'Anna' }, items: [], sourcesUnavailable: [] },
          { toolName: 'search_content', items: ITEMS, sourcesUnavailable: [] }
        ]
      })
    );
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText('Hier sind Treffer.'));
    expect(
      view.getAllByText(m.termi_card_all({ type: m.discover_tab_learning(), topic: 'Brüche 1' }))
    ).toHaveLength(1);
  });

  it('the answer renders as safe markdown: headings and lists, links only as text', async () => {
    stubFetch(() =>
      streamAnswer({
        text: '# Überblick\n\n- erster Punkt\n- [Quelle](https://evil.example)\n\n<img src=x onerror="alert(1)">'
      })
    );
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    const heading = await waitFor(() => view.getByText('Überblick'));
    expect(heading.tagName).toBe('H3');
    const answer = /** @type {HTMLElement} */ (heading.parentElement);
    expect([...answer.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'erster Punkt',
      'Quelle'
    ]);
    expect(answer.querySelector('a, img')).toBeNull();
    expect(answer.textContent).toContain('<img src=x onerror="alert(1)">');
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

  it('HTTP 429 with no scope (busy: another tab) → termi_busy, no quota link, no tier-1 rescue', async () => {
    let searchCalls = 0;
    chatCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
        if (url.startsWith('/api/termi/eligible')) return eligibleAnswer();
        if (url === '/api/termi') return new Response(JSON.stringify({ matches: [] }));
        if (url === '/api/termi/search') {
          searchCalls++;
          return new Response(JSON.stringify({ items: [], sourcesUnavailable: [] }));
        }
        chatCalls.push({ url, init });
        return new Response(JSON.stringify({ error: 'busy' }), { status: 429 });
      })
    );
    const view = renderWindow();
    await type(view, 'Finde Materialien zu Brüchen');
    await waitFor(() => view.getByText(m.termi_busy(), { exact: false }));
    expect(view.queryByText(m.termi_quota(), { exact: false })).toBeNull();
    expect(view.queryByText(m.termi_quota_global(), { exact: false })).toBeNull();
    expect(view.queryByText(m.termi_quota_link())).toBeNull();
    expect(searchCalls).toBe(0);
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

  describe('document mode', () => {
    const DOC = '# Titel\n\n## Abschnitt\n\nText.';
    const SOURCES =
      '## Quellen und Lizenzen\n\n' +
      `- Brüche verstehen, CC BY 4.0, ${location.origin}/naddr1one\n` +
      `- Bruchrechnen üben, Lizenz nicht angegeben, ${location.origin}/naddr1two`;
    /** @param {() => void} [onClose] */
    async function docView(onClose = () => {}) {
      stubFetch(() => streamAnswer({ toolName: 'search_passages', text: DOC }));
      const view = render(TermiChatWindow, {
        props: {
          onToggleExpand: () => {},
          onClose,
          hints: [],
          openCount: 0,
          runHint: vi.fn(),
          customizeHint: vi.fn(),
          dismissHint: vi.fn()
        }
      });
      await type(view, 'Fasse Brüche auf einer A4-Seite zusammen');
      await waitFor(() => view.getByTestId('termi-doc-actions'));
      return view;
    }

    it('a short answer offers no document actions', async () => {
      stubFetch(() => streamAnswer());
      const view = renderWindow();
      await type(view, 'Finde Materialien zu Brüchen');
      await waitFor(() => view.getByText('Hier sind Treffer.'));
      expect(view.queryByTestId('termi-doc-actions')).toBeNull();
    });

    it('copy writes the markdown plus the sources section, then reads "Kopiert"', async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      const view = await docView();
      expect(view.getByTestId('termi-doc-actions').querySelectorAll('button')).toHaveLength(4);
      await fireEvent.click(view.getByTestId('termi-doc-copy'));
      expect(writeText).toHaveBeenCalledWith(`${DOC}\n\n${SOURCES}`);
      await waitFor(() =>
        expect(view.getByTestId('termi-doc-copy').textContent?.trim()).toBe(m.termi_doc_copied())
      );
    });

    it('a refused clipboard reads "Kopieren nicht möglich"', async () => {
      const writeText = vi.fn(async () => {
        throw new Error('denied');
      });
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      const view = await docView();
      await fireEvent.click(view.getByTestId('termi-doc-copy'));
      await waitFor(() =>
        expect(view.getByTestId('termi-doc-copy').textContent?.trim()).toBe(
          m.termi_doc_copy_failed()
        )
      );
    });

    it('people and communities found alongside are no sources', async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      stubFetch(() =>
        streamAnswer({
          text: DOC,
          calls: [
            { toolName: 'search_passages', items: ITEMS, sourcesUnavailable: [] },
            {
              toolName: 'find_people',
              input: { name: 'Anna' },
              items: [{ type: 'person', id: 'f'.repeat(64), title: 'Anna', href: '/p/npub1x' }],
              sourcesUnavailable: []
            }
          ]
        })
      );
      const view = renderWindow();
      await type(view, 'Fasse Brüche auf einer A4-Seite zusammen');
      await waitFor(() => view.getByTestId('termi-doc-actions'));
      await fireEvent.click(view.getByTestId('termi-doc-copy'));
      expect(writeText).toHaveBeenCalledWith(`${DOC}\n\n${SOURCES}`);
    });

    it('download saves termi-titel.md as text/markdown', async () => {
      /** @type {Blob[]} */
      const blobs = [];
      URL.createObjectURL = vi.fn((/** @type {Blob} */ b) => (blobs.push(b), 'blob:x'));
      URL.revokeObjectURL = vi.fn();
      /** @type {string[]} */
      const names = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        /** @this {HTMLAnchorElement} */ function () {
          names.push(this.download);
        }
      );
      const view = await docView();
      await fireEvent.click(view.getByTestId('termi-doc-download'));
      expect(names).toEqual(['termi-titel.md']);
      expect(blobs[0].type).toBe('text/markdown;charset=utf-8');
      expect(await blobs[0].text()).toBe(`${DOC}\n\n${SOURCES}`);
      click.mockRestore();
    });

    describe('"Als LiaScript-Kurs öffnen"', () => {
      const COURSE = 'https://liascript.github.io/course/?nostr:naddr1draft';
      /** @type {{ location: { href: string }, opener: any, close: any }} */
      let tab;
      beforeEach(() => {
        createArticle.mockReset();
        tab = { location: { href: 'about:blank' }, opener: {}, close: vi.fn() };
        vi.stubGlobal(
          'open',
          vi.fn(() => tab)
        );
      });

      it('saves the document as an unlisted draft once, then opens it from Nostr', async () => {
        createArticle.mockResolvedValue({ naddr: 'naddr1draft' });
        const onClose = vi.fn();
        const view = await docView(onClose);
        const button = view.getByTestId('termi-doc-liascript');
        expect(button.textContent?.trim()).toBe(m.termi_doc_liascript());
        await fireEvent.click(button);
        await waitFor(() => view.getByTestId('termi-doc-draft-saved'));
        expect(createArticle).toHaveBeenCalledWith(
          {
            title: 'Titel',
            content: `## Abschnitt\n\nText.\n\n${SOURCES}`,
            summary: 'Text.',
            image: ''
          },
          undefined,
          null,
          { draft: true, awaitPublish: true }
        );
        // the tab opens inside the click (popup blockers), the course URL follows
        expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
        expect(tab.opener).toBeNull();
        expect(tab.location.href).toBe(COURSE);
        const edit = view.getByTestId('termi-doc-draft-saved').querySelector('a');
        expect(edit?.getAttribute('href')).toBe('/create/article?edit=naddr1draft');
        expect(edit?.textContent?.trim()).toBe(m.termi_doc_draft_edit());

        await fireEvent.click(view.getByTestId('termi-doc-liascript'));
        expect(createArticle).toHaveBeenCalledTimes(1);
        expect(window.open).toHaveBeenLastCalledWith(COURSE, '_blank', 'noopener');

        // the editor link opens the editor and closes Termi, like the article-draft action
        edit?.addEventListener('click', (e) => e.preventDefault()); // jsdom: no navigation
        await fireEvent.click(/** @type {HTMLAnchorElement} */ (edit));
        expect(onClose).toHaveBeenCalled();
      });

      it('busy until a relay accepted the draft; the tab waits on about:blank', async () => {
        /** @type {(v: any) => void} */
        let accept = () => {};
        createArticle.mockReturnValue(new Promise((r) => (accept = r)));
        const view = await docView();
        const button = /** @type {HTMLButtonElement} */ (view.getByTestId('termi-doc-liascript'));
        await fireEvent.click(button);
        await waitFor(() => expect(button.disabled).toBe(true));
        expect(button.querySelector('.loading')).not.toBeNull();
        expect(tab.location.href).toBe('about:blank');
        accept({ naddr: 'naddr1draft' });
        await waitFor(() => expect(tab.location.href).toBe(COURSE));
        expect(button.disabled).toBe(false);
      });

      it('no relay accepted the draft: no LiaScript tab, the error shows', async () => {
        createArticle.mockRejectedValue(new Error('publish_failed'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const view = await docView();
        await fireEvent.click(view.getByTestId('termi-doc-liascript'));
        await waitFor(() =>
          expect(view.getByTestId('termi-doc-draft-failed').textContent?.trim()).toBe(
            m.termi_doc_draft_failed()
          )
        );
        expect(tab.close).toHaveBeenCalled();
        expect(tab.location.href).toBe('about:blank');
        expect(view.queryByTestId('termi-doc-draft-saved')).toBeNull();
      });
    });

    it('a LiaScript header comment shows in no bubble', async () => {
      stubFetch(() =>
        streamAnswer({
          toolName: 'search_passages',
          text: '<!--\nauthor: edufeed Termi\n-->\n\n# Kurs\n\nText.'
        })
      );
      const view = renderWindow();
      await type(view, 'mach mir einen liascript-kurs');
      await waitFor(() => view.getByTestId('termi-doc-actions'));
      expect(view.queryByText(/author: edufeed Termi/)).toBeNull();
      expect(view.getByText('Kurs')).toBeTruthy();
    });

    it('article draft stashes title + content, navigates and closes the window', async () => {
      const onClose = vi.fn();
      const view = await docView(onClose);
      await fireEvent.click(view.getByTestId('termi-doc-article'));
      expect(termiEnv.goto).toHaveBeenCalledWith('/create/article?prefill=termi');
      expect(onClose).toHaveBeenCalled();
      // the title has its own field: the draft drops the # line
      expect(takeArticlePrefill()).toEqual({
        title: 'Titel',
        content: `## Abschnitt\n\nText.\n\n${SOURCES}`
      });
    });
  });
});
