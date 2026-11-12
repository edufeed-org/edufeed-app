/** @vitest-environment jsdom */
// Conversation history in the window: record after each exchange, reopen
// (tier 1 → window turns; tier 2 → the chat only when it runs), "Neue Unterhaltung".
import { termiEnv, windowProps } from './termi-window-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const SK = generateSecretKey();
const user = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
termiEnv.getUser = () => user.current;
const fake = vi.hoisted(() => ({
  store: /** @type {any} */ (null),
  scopes: /** @type {string[]} */ ([])
}));

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
const createArticle = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/article-actions.svelte.js', () => ({ createArticle }));
const loadLessonDraft = vi.hoisted(() => vi.fn());
const saveLessonDraft = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/lesson-drafts.svelte.js', () => ({ loadLessonDraft, saveLessonDraft }));
// the publish modal pulls the publish stack in; the pool is not mocked here
vi.mock('$lib/stores/lesson-publish.svelte.js', () => ({
  LICENCES: { 'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/' },
  defaultLicence: () => 'CC BY 4.0',
  seriesTitle: () => 'Reihe',
  publishLessonSeries: vi.fn()
}));
termiEnv.history.createConversationStore = ({ scope }) => {
  fake.scopes.push(scope);
  return fake.store;
};

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
  return render(TermiChatWindow, { props: windowProps() });
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

/** Records that end with an answer (a chat turn is also recorded when it starts). @param {number} n */
const answersRecorded = (n) =>
  waitFor(() =>
    expect(
      fake.store.record.mock.calls.filter(
        (/** @type {any[]} */ c) => c[0].at(-1)?.role === 'assistant'
      )
    ).toHaveLength(n)
  );

/**
 * What `record` really stores for a tier-2 chat: the router question (a window turn)
 * (tier 1) plus the chat turns. @param {string[]} [followUps] @returns {Promise<any>}
 */
async function recordedTier2(followUps = []) {
  loginEligible();
  chatAnswer = () => streamWithCards();
  const view = renderWindow();
  await type(view, 'Finde Brüche');
  await answersRecorded(1);
  for (const [i, q] of followUps.entries()) {
    await sendIdle(view);
    await type(view, q);
    await answersRecorded(i + 2);
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
    // one AnswerBubble per turn, nothing rendered twice
    expect(view.getAllByTestId('termi-answer').map((e) => e.dataset.role)).toEqual([
      'user',
      'assistant'
    ]);
  });

  it('a conversation from the last hours reopens by itself after a reload; an old one does not', async () => {
    await recordedTier2();
    user.current = null;
    // the record as the store lists it right after a reload: fresh
    fake.store.list[0].updatedAt = Date.now() - 60_000;
    const view = renderWindow();
    await waitFor(() => view.getByText('Drei Treffer.'));
    expect(fake.store.open).toHaveBeenCalledWith('c2');
    expect(view.queryByTestId('termi-history')).toBeNull();
    view.unmount();

    fake.store = makeStore({ id: 'c2', title: 'Brüche', createdAt: 1, updatedAt: 1, turns: [] });
    const again = renderWindow();
    await waitFor(() => again.getByTestId('termi-input'));
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.store.open).not.toHaveBeenCalled();
    expect(again.queryByText('Drei Treffer.')).toBeNull();
  });

  // Wiring through the real @ai-sdk Chat: the restored turns are what it sends next.
  it('single exchange, as recorded: with a running chat it continues, tool part included', async () => {
    await recordedTier2();
    const view = await liveChatThenOpen();
    expect(view.queryByText('Erste Frage')).toBeNull();
    expect(view.getAllByText('Finde Brüche')).toHaveLength(1);
    await waitFor(() => expect(view.getAllByTestId('termi-card-resource')).toHaveLength(3));
    // the router question (tier 1) and the chat's answer (tier 2): one AnswerBubble each
    expect(view.getAllByTestId('termi-answer').map((e) => e.dataset.role)).toEqual([
      'user',
      'assistant'
    ]);

    await type(view, 'Nur Klasse 6');
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    const sent = JSON.parse(String(chatCalls[1].init.body)).messages;
    expect(sent.map((/** @type {any} */ x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[0].parts[0].text).toBe('Finde Brüche');
    expect(sent[1].parts[0]).toMatchObject({ type: 'dynamic-tool', toolName: 'search_content' });
  });

  it('"Neue Unterhaltung" clears the window and the chat', async () => {
    loginEligible();
    const view = renderWindow();
    await type(view, 'Erste Frage');
    await waitFor(() => view.getByText('Live-Antwort.'));
    await answersRecorded(1);
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

  it('a restored tier-2 answer renders as safe markdown', async () => {
    fake.store = makeStore({
      id: 'c4',
      title: 'Brüche',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Wie erkläre ich Brüche?', tier: 2 },
        { role: 'assistant', text: '## Schritte\n\n1. [Pizza](https://x) teilen', tier: 2 }
      ]
    });
    const view = renderWindow();
    await openStored(view);
    const heading = await waitFor(() => view.getByText('Schritte'));
    expect(heading.tagName).toBe('H4');
    const answer = /** @type {HTMLElement} */ (heading.parentElement);
    expect(answer.querySelector('ol li')?.textContent).toBe('Pizza teilen');
    expect(answer.querySelector('a')).toBeNull();
  });

  it('a tier-1 bot turn (a re-saved tier-2 answer) also renders as safe markdown', async () => {
    fake.store = makeStore({
      id: 'c6',
      title: 'Brüche',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Wie erkläre ich Brüche?', tier: 1 },
        { role: 'assistant', text: '## Schritte\n\n- [Pizza](https://x) teilen', tier: 1 }
      ]
    });
    const view = renderWindow();
    await openStored(view);
    const heading = await waitFor(() => view.getByText('Schritte'));
    expect(heading.tagName).toBe('H4');
    expect(/** @type {HTMLElement} */ (heading.parentElement).querySelector('a')).toBeNull();
  });

  it('a restored document answer offers copy + download, the article draft only when logged in', async () => {
    user.current = null;
    fake.store = makeStore({
      id: 'c5',
      title: 'Doc',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Fasse zusammen', tier: 2 },
        { role: 'assistant', text: '# Titel\n\nText.', tier: 2 }
      ]
    });
    const view = renderWindow();
    await openStored(view);
    const box = await waitFor(() => view.getByTestId('termi-doc-actions'));
    expect([...box.querySelectorAll('button')].map((b) => b.dataset.testid)).toEqual([
      'termi-doc-copy',
      'termi-doc-download'
    ]);
  });

  it('a restored document whose tool outputs the size cap dropped offers no document actions', async () => {
    fake.store = makeStore({
      id: 'c8',
      title: 'Doc',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Fasse zusammen', tier: 2 },
        { role: 'assistant', text: '# Titel\n\nText.', tier: 2, sourcesLost: true }
      ]
    });
    const view = renderWindow();
    await openStored(view);
    await waitFor(() => view.getByText('Titel'));
    expect(view.queryByTestId('termi-doc-actions')).toBeNull();
  });

  it('a capped document restored into a running chat offers no document actions either', async () => {
    fake.store = makeStore({
      id: 'c9',
      title: 'Doc',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Fasse zusammen', tier: 2 },
        { role: 'assistant', text: '# Titel\n\nText.', tier: 2, sourcesLost: true }
      ]
    });
    const view = await liveChatThenOpen();
    await waitFor(() => view.getByText('Titel'));
    expect(view.queryByTestId('termi-doc-actions')).toBeNull();
  });

  describe('the LiaScript draft naddr stays on the turn', () => {
    const NADDR = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk';
    const COURSE = `https://liascript.github.io/course/?nostr:${NADDR}`;
    const stored = () =>
      makeStore({
        id: 'c10',
        title: 'Doc',
        createdAt: 1,
        updatedAt: 1,
        turns: [
          { role: 'user', text: 'Fasse zusammen', tier: 2 },
          {
            role: 'assistant',
            text: '# Titel\n\nText.',
            tier: 2,
            artifacts: { draftNaddr: NADDR }
          }
        ]
      });
    beforeEach(() => {
      createArticle.mockReset();
      vi.stubGlobal(
        'open',
        vi.fn(() => null)
      );
    });

    it('a saved draft is recorded with the answer', async () => {
      loginEligible();
      chatAnswer = () => streamText('# Titel\n\nText.');
      createArticle.mockResolvedValue({ naddr: NADDR });
      const view = renderWindow();
      await type(view, 'Fasse Brüche zusammen');
      await fireEvent.click(await waitFor(() => view.getByTestId('termi-doc-liascript')));
      await waitFor(() =>
        expect(fake.store.record.mock.calls.at(-1)[0].at(-1).artifacts?.draftNaddr).toBe(NADDR)
      );
    });

    it.each([
      ['read-only', async () => (loginEligible(), renderWindow())],
      ['into a running chat', async () => liveChatThenOpen()]
    ])('restored %s: no second draft, the course opens from the stored naddr', async (_, open) => {
      fake.store = stored();
      const view = await open();
      if (!view.queryByTestId('termi-doc-actions')) await openStored(view);
      await waitFor(() => view.getByTestId('termi-doc-draft-saved'));
      expect(
        view.getByTestId('termi-doc-draft-saved').querySelector('a')?.getAttribute('href')
      ).toBe(`/create/article?edit=${NADDR}`);
      await fireEvent.click(view.getByTestId('termi-doc-liascript'));
      expect(createArticle).not.toHaveBeenCalled();
      expect(window.open).toHaveBeenCalledWith(COURSE, '_blank', 'noopener');
    });
  });
});

describe('a stored lesson answer (Review Focus 4)', () => {
  const WRAP = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk';
  const STUB = '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nAnfang …';
  const lessonConv = () => ({
    id: 'c3',
    title: 'Brüche',
    createdAt: 1,
    updatedAt: 1,
    task: 'lesson',
    turns: [
      { role: 'user', text: 'Reihe zu Brüchen', tier: 2 },
      {
        role: 'assistant',
        text: STUB,
        tier: 2,
        textStub: true,
        artifacts: { draftWraps: { 'lesson-1': WRAP } }
      }
    ]
  });

  it('a signer without nip44: "Entwurf laden" fails with the unreadable line, the stub stays', async () => {
    loginEligible(); // its signer has no nip44 → the store answers null
    loadLessonDraft.mockReset().mockResolvedValue(null);
    fake.store = makeStore(lessonConv());
    const view = renderWindow();
    await openStored(view);
    // a stub offers no export of its cut text, only the load
    const load = await waitFor(() => view.getByTestId('termi-doc-load_draft'));
    expect(view.queryByTestId('termi-doc-copy')).toBeNull();
    expect(view.queryByTestId('termi-doc-save_draft')).toBeNull();
    await fireEvent.click(load);
    await waitFor(() => view.getByTestId('termi-lesson-draft-unreadable'));
    expect(view.getByTestId('termi-lesson-draft-unreadable').textContent).toContain(
      m.termi_lesson_draft_unreadable()
    );
    expect(loadLessonDraft).toHaveBeenCalledWith(WRAP);
    expect(view.getByText('Anfang …')).toBeTruthy();
  });

  it('Werkbank: opening loads every stub; a failed one marks its row, a click retries', async () => {
    const W2 = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vl';
    loginEligible();
    // primed: two imports racing in one tick resolve the mock for only one of them
    await import('$lib/stores/lesson-drafts.svelte.js');
    let w2ok = false;
    loadLessonDraft
      .mockReset()
      .mockImplementation(async (/** @type {string} */ naddr) =>
        naddr === WRAP
          ? { title: 'Überblick', content: '# Überblick\n\nDer Überblick.', dTag: 'd' }
          : w2ok
            ? { title: 'Stunde 1', content: '# Stunde 1\n\nDie Stunde.', dTag: 'e' }
            : null
      );
    const conv = /** @type {any} */ ({ ...lessonConv(), lesson: { phase: 5, plan: [{ n: 1 }] } });
    conv.turns = [
      conv.turns[0],
      {
        ...conv.turns[1],
        text: '<!-- termi:part overview -->\n# Überblick\n\nAnf …',
        artifacts: { draftWraps: { overview: WRAP } }
      },
      { role: 'user', text: 'weiter', tier: 2 },
      {
        ...conv.turns[1],
        text: '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nAnf …',
        artifacts: { draftWraps: { 'lesson-1': W2 } }
      }
    ];
    fake.store = makeStore(conv);
    const view = render(TermiChatWindow, { props: { ...windowProps(), workbench: true } });
    await openStored(view);
    await waitFor(() => expect(loadLessonDraft).toHaveBeenCalledTimes(2), { timeout: 5000 });
    // the rail: Überblick, then Stunde 1
    const row = (/** @type {string} */ t) =>
      view.getAllByTestId('werkbank-part')[t === 'Stunde 1' ? 1 : 0];
    await waitFor(() => expect(row('Stunde 1')?.getAttribute('data-state')).toBe('failed'), {
      timeout: 5000
    });
    expect(row('Überblick')?.getAttribute('data-state')).toBe('saved');
    // no manual load button in the Werkbank
    expect(view.queryByTestId('termi-doc-load_draft')).toBeNull();
    w2ok = true;
    await fireEvent.click(/** @type {HTMLElement} */ (row('Stunde 1')));
    await waitFor(() => expect(row('Stunde 1')?.getAttribute('data-state')).toBe('saved'));
  }, 15000);

  it('Werkbank: opening loads the first stub alone, then the rest at most two at a time', async () => {
    loginEligible();
    await import('$lib/stores/lesson-drafts.svelte.js');
    let running = 0;
    let most = 0;
    /** @type {number[]} */
    const startedWith = [];
    loadLessonDraft.mockReset().mockImplementation(async (/** @type {string} */ naddr) => {
      startedWith.push(running);
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return { title: naddr, content: `# ${naddr.slice(-4)}\n\nText.`, dTag: 'd' };
    });
    const W = (/** @type {number} */ i) => WRAP.slice(0, -1) + 'acdefg'[i];
    const conv = /** @type {any} */ ({ ...lessonConv(), lesson: { phase: 5, plan: [] } });
    conv.turns = [0, 1, 2, 3, 4].flatMap((i) => [
      { role: 'user', text: `Teil ${i}`, tier: 2 },
      {
        role: 'assistant',
        text: `<!-- termi:part lesson ${i + 1} -->\n# Stunde ${i + 1}\n\nAnf …`,
        tier: 2,
        textStub: true,
        artifacts: { draftWraps: { [`lesson-${i + 1}`]: W(i) } }
      }
    ]);
    fake.store = makeStore(conv);
    const view = render(TermiChatWindow, { props: { ...windowProps(), workbench: true } });
    await openStored(view);
    await waitFor(() => expect(loadLessonDraft).toHaveBeenCalledTimes(5), { timeout: 5000 });
    await waitFor(() => expect(running).toBe(0));
    expect(startedWith[0]).toBe(0);
    expect(startedWith[1]).toBe(0); // the second waits for the first
    expect(most).toBe(2);
  }, 15000);

  it('a readable wrap replaces the stub with the whole part', async () => {
    loginEligible();
    loadLessonDraft.mockReset().mockResolvedValue({
      title: 'Stunde 1',
      content: '# Stunde 1\n\nDer ganze Text.',
      dTag: 'd'
    });
    fake.store = makeStore(lessonConv());
    const view = renderWindow();
    await openStored(view);
    await fireEvent.click(await waitFor(() => view.getByTestId('termi-doc-load_draft')));
    await waitFor(() => view.getByText('Der ganze Text.'));
    expect(view.queryByTestId('termi-doc-load_draft')).toBeNull();
  });

  it('a restored lesson record keeps its parts: the publish modal lists them as missing (reload after planning)', async () => {
    loginEligible();
    fake.store = makeStore({
      id: 'c9',
      title: 'Nachhaltigkeit',
      createdAt: 1,
      updatedAt: 1,
      task: 'lesson',
      lesson: { phase: 7 },
      turns: [
        { role: 'user', text: 'Reihe zu Nachhaltigkeit', tier: 2 },
        {
          role: 'assistant',
          text: '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nVoller Text.',
          tier: 2
        },
        { role: 'user', text: 'veröffentlichen', tier: 2 },
        {
          role: 'assistant',
          text: '<!-- termi:part sources -->\n# Quellen und Lizenzen\n\nKeine.',
          tier: 2
        }
      ]
    });
    const view = renderWindow();
    await openStored(view);
    await waitFor(() => view.getAllByTestId('termi-doc-save_draft'));
    await fireEvent.click(view.getByTestId('termi-doc-publish_series'));
    const modal = await waitFor(() => view.getByTestId('lesson-publish-modal'));
    const keys = [...modal.querySelectorAll('[data-testid=lesson-publish-part]')].map((li) =>
      li.getAttribute('data-key')
    );
    expect(keys).toEqual(expect.arrayContaining(['lesson-1', 'sources']));
    expect(modal.textContent).toContain(m.termi_lesson_part_missing());
  });
});

describe('a stored, saved ask document', () => {
  const WRAP = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk';

  it('opens the Werkbank by itself (it never asks to close) and loads the document from its wrap', async () => {
    loginEligible();
    await import('$lib/stores/lesson-drafts.svelte.js');
    loadLessonDraft
      .mockReset()
      .mockResolvedValue({ title: 'Handout', content: '# Handout\n\nDer ganze Text.', dTag: 'd' });
    fake.store = makeStore({
      id: 'd1',
      title: 'Handout',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Schreibe ein Handout', tier: 2 },
        {
          role: 'assistant',
          text: '# Handout\n\nAnfang …',
          tier: 2,
          textStub: true,
          artifacts: { draftWraps: { document: WRAP } }
        }
      ]
    });
    const onWorkbench = vi.fn();
    const view = render(TermiChatWindow, { props: { ...windowProps(), onWorkbench } });
    await openStored(view);
    await waitFor(() => expect(onWorkbench).toHaveBeenCalledWith(true));
    // the parent grants it; the stub loads, the document is the one row
    await view.rerender({ ...windowProps(), workbench: true, onWorkbench });
    await waitFor(() => expect(loadLessonDraft).toHaveBeenCalledWith(WRAP), { timeout: 5000 });
    await waitFor(() => expect(view.getAllByTestId('werkbank-part')).toHaveLength(1), {
      timeout: 5000
    });
    expect(onWorkbench).not.toHaveBeenCalledWith(false);
  }, 15000);

  it('a document whose wrap would not open gets a failed row; a click on it retries', async () => {
    loginEligible();
    await import('$lib/stores/lesson-drafts.svelte.js');
    let ok = false;
    loadLessonDraft
      .mockReset()
      .mockImplementation(async () =>
        ok ? { title: 'Handout', content: '# Handout\n\nDer ganze Text.', dTag: 'd' } : null
      );
    fake.store = makeStore({
      id: 'd3',
      title: 'Handout',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Schreibe ein Handout', tier: 2 },
        {
          role: 'assistant',
          text: '# Handout\n\nAnfang …',
          tier: 2,
          textStub: true,
          artifacts: { draftWraps: { document: WRAP } }
        }
      ]
    });
    const view = render(TermiChatWindow, { props: { ...windowProps(), workbench: true } });
    await openStored(view);
    const row = await waitFor(
      () => {
        const r = view.getByTestId('werkbank-part');
        expect(r.getAttribute('data-state')).toBe('failed');
        return r;
      },
      { timeout: 5000 }
    );
    ok = true;
    await fireEvent.click(row);
    await waitFor(() =>
      expect(view.getByTestId('werkbank-part').getAttribute('data-state')).toBe('saved')
    );
  }, 15000);

  it('opening a conversation with an unsaved document in the Werkbank saves it once', async () => {
    loginEligible();
    saveLessonDraft.mockReset().mockResolvedValue({ naddr: WRAP, dTag: 'd' });
    fake.store = makeStore({
      id: 'd4',
      title: 'Handout',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Schreibe ein Handout', tier: 2 },
        { role: 'assistant', text: '# Handout\n\n' + 'Text '.repeat(300), tier: 2 }
      ]
    });
    const view = render(TermiChatWindow, { props: { ...windowProps(), workbench: true } });
    await openStored(view);
    await waitFor(() => expect(saveLessonDraft).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(saveLessonDraft.mock.calls[0][0].part.key ?? 'document').toBe('document');
    await waitFor(() =>
      expect(view.getByTestId('werkbank-part').getAttribute('data-state')).toBe('saved')
    );
  }, 15000);

  it('an earlier document is never saved over a later one still in its (unloaded) wrap', async () => {
    loginEligible();
    await import('$lib/stores/lesson-drafts.svelte.js');
    saveLessonDraft.mockReset().mockResolvedValue({ naddr: WRAP, dTag: 'd' });
    loadLessonDraft.mockReset().mockResolvedValue(null); // the later one would not open
    fake.store = makeStore({
      id: 'd5',
      title: 'Handout',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Schreibe ein Handout', tier: 2 },
        { role: 'assistant', text: '# Handout\n\n' + 'Text '.repeat(300), tier: 2 },
        { role: 'user', text: 'Jetzt ein Quiz', tier: 2 },
        {
          role: 'assistant',
          text: '# Quiz\n\nAnfang …',
          tier: 2,
          textStub: true,
          artifacts: { draftWraps: { document: WRAP } }
        }
      ]
    });
    const view = render(TermiChatWindow, { props: { ...windowProps(), workbench: true } });
    await openStored(view);
    await waitFor(() => expect(loadLessonDraft).toHaveBeenCalled(), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(saveLessonDraft).not.toHaveBeenCalled();
  }, 15000);

  it('a later document is not saved over an earlier one still in its (unloaded) wrap; after the load it is', async () => {
    loginEligible();
    await import('$lib/stores/lesson-drafts.svelte.js');
    saveLessonDraft.mockReset().mockResolvedValue({ naddr: WRAP, dTag: 'd' });
    /** @type {(v: any) => void} */
    let release = () => {};
    loadLessonDraft.mockReset().mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        })
    );
    fake.store = makeStore({
      id: 'd6',
      title: 'Handout',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Schreibe ein Handout', tier: 2 },
        {
          role: 'assistant',
          text: '# Handout\n\nAnfang …',
          tier: 2,
          textStub: true,
          artifacts: { draftWraps: { document: WRAP } }
        },
        { role: 'user', text: 'Jetzt ein Quiz', tier: 2 },
        { role: 'assistant', text: '# Quiz\n\n' + 'Frage '.repeat(300), tier: 2 }
      ]
    });
    const view = render(TermiChatWindow, { props: { ...windowProps(), workbench: true } });
    await openStored(view);
    await waitFor(() => expect(loadLessonDraft).toHaveBeenCalledWith(WRAP), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(saveLessonDraft).not.toHaveBeenCalled();
    release({ title: 'Handout', content: '# Handout\n\nDer ganze Text.', dTag: 'd' });
    await waitFor(() => expect(saveLessonDraft).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(saveLessonDraft.mock.calls[0][0].part.title).toBe('Quiz');
  }, 15000);

  // live 2026-11-12: two requests meant for a new conversation went into a restored series
  it('in the Werkbank a restored draft shows "Neue Unterhaltung", never the starter chips', async () => {
    loginEligible();
    fake.store = makeStore({
      id: 'd2',
      title: 'Handout',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Schreibe ein Handout', tier: 2 },
        { role: 'assistant', text: '# Handout\n\n' + 'Text '.repeat(300), tier: 2 }
      ]
    });
    const view = render(TermiChatWindow, { props: { ...windowProps(), workbench: true } });
    await openStored(view);
    await waitFor(() => view.getByText('Schreibe ein Handout'));
    expect(view.queryByText(m.termi_sugg_1_q())).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: m.termi_history_new() }));
    expect(fake.store.startNew).toHaveBeenCalled();
  });
});

describe('opening a draft from outside (?termi=<id>)', () => {
  const lesson = (/** @type {string} */ id) => ({
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    task: 'lesson',
    lesson: { phase: 2 },
    turns: [{ role: 'user', text: 'Reihe', tier: 2 }]
  });
  const storeWith = (/** @type {string[]} */ ids) => ({
    ...makeStore(),
    open: vi.fn(async (/** @type {string} */ id) => {
      if (!ids.includes(id)) throw new Error('not found');
      return lesson(id);
    })
  });
  const props = (/** @type {any} */ extra) => ({ ...windowProps(), ...extra });

  it('opens the draft once the history is ready, enters the Werkbank and clears the request', async () => {
    loginEligible();
    fake.store = storeWith(['abc']);
    const onWorkbench = vi.fn();
    const onPendingHandled = vi.fn();
    render(TermiChatWindow, { props: props({ pendingId: 'abc', onWorkbench, onPendingHandled }) });
    await waitFor(() => expect(fake.store.open).toHaveBeenCalledWith('abc'));
    await waitFor(() => expect(onWorkbench).toHaveBeenCalledWith(true));
    expect(onPendingHandled).toHaveBeenCalled();
  });

  it('a pending draft wins: the newest recent record is not reopened on its own beside it', async () => {
    loginEligible();
    fake.store = storeWith(['abc', 'newest']);
    fake.store.list = [{ id: 'newest', title: 'n', createdAt: 1, updatedAt: Date.now() }];
    const onWorkbench = vi.fn();
    render(TermiChatWindow, { props: props({ pendingId: 'abc', onWorkbench }) });
    await waitFor(() => expect(fake.store.open).toHaveBeenCalledWith('abc'));
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.store.open).not.toHaveBeenCalledWith('newest');
  });

  it('an unknown id leaves the window as it is: no Werkbank', async () => {
    loginEligible();
    fake.store = storeWith([]);
    const onWorkbench = vi.fn();
    const onPendingHandled = vi.fn();
    render(TermiChatWindow, { props: props({ pendingId: 'nope', onWorkbench, onPendingHandled }) });
    await waitFor(() => expect(onPendingHandled).toHaveBeenCalled());
    expect(fake.store.open).toHaveBeenCalledWith('nope');
    expect(onWorkbench).not.toHaveBeenCalledWith(true);
  });

  it('draft A, then C, then A again enters the Werkbank every time', async () => {
    loginEligible();
    fake.store = storeWith(['a', 'c']);
    const onWorkbench = vi.fn();
    const view = render(TermiChatWindow, { props: props({ onWorkbench }) });
    for (const [i, id] of ['a', 'c', 'a'].entries()) {
      await view.rerender(props({ onWorkbench, pendingId: id }));
      await waitFor(() =>
        expect(onWorkbench.mock.calls.filter((c) => c[0] === true)).toHaveLength(i + 1)
      );
      await view.rerender(props({ onWorkbench, pendingId: null }));
    }
  });
});
