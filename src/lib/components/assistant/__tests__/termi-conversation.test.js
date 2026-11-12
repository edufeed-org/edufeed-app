/** @vitest-environment node */
// The conversation controller without the window: router and canned replies,
// tier 1, the tier-2 chat lifecycle (with a fake chat), the account-switch
// reset and history save/restore. The window tests keep only the wiring.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const env = vi.hoisted(() => ({
  config: /** @type {Record<string, any>} */ ({}),
  runCreateAction: /** @type {import('vitest').Mock} */ (/** @type {any} */ (null))
}));
env.runCreateAction = vi.fn(() => true);
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: env.config }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/helpers/run-create-action.js', () => ({
  runCreateAction: (/** @type {any[]} */ ...a) => env.runCreateAction(...a)
}));
vi.mock('$lib/services/blocked-authors.svelte.js', () => ({
  isBlockedAuthor: (/** @type {string} */ pk) => pk === 'b'.repeat(64),
  getBlockedAuthorsVersion: () => 0
}));

const { createConversation } = await import('../termi-conversation.svelte.js');
const { _resetTermiEligibilityForTests } = await import('../termi-router.js');
const { fromContent, toContent } = await import('../history/conversation-codec.js');

const ALICE = { pubkey: 'a'.repeat(64), type: 'nsec', signer: { signEvent: vi.fn() } };
const BOB = { pubkey: 'd'.repeat(64), type: 'nsec', signer: { signEvent: vi.fn() } };
const Q = 'Finde Materialien zu Brüchen';
const item = (/** @type {number} */ n) => ({
  type: 'resource',
  id: `30142:pk:${n}`,
  title: `Material ${n}`,
  href: `/naddr1x${n}`
});
const ITEMS = [item(1), item(2)];

/** @returns {{ promise: Promise<any>, resolve: (v?: any) => void }} */
function deferred() {
  /** @type {(v?: any) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
/** @param {() => boolean} cond */
async function until(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await flush();
  expect(cond()).toBe(true);
}

/** @param {string} text @param {any[]} [toolParts] */
const assistantMsg = (text, toolParts = []) => ({
  role: 'assistant',
  parts: [...toolParts, ...(text ? [{ type: 'text', text }] : [])]
});
/** @param {string} query @param {any[]} items @param {string} [toolName] */
const toolPart = (query, items, toolName = 'search_content') => ({
  type: 'dynamic-tool',
  toolName,
  toolCallId: `k-${query}`,
  state: 'output-available',
  input: { query },
  output: { items, sourcesUnavailable: [] }
});
/** @param {number} status @param {string} [scope] */
const httpError = (status, scope) =>
  Object.assign(new Error(`termi chat ${status}`), { status, scope });

/**
 * A stand-in for the @ai-sdk Chat: each send/regenerate plays the next answer —
 * an assistant message, or an Error that becomes `chat.error`.
 * @param {() => any} answer
 */
function fakeChat(answer) {
  let n = 0;
  /** @type {any} */
  const chat = {
    messages: [],
    status: 'ready',
    error: undefined,
    async sendMessage(/** @type {{ text: string }} */ { text }) {
      chat.messages = [
        ...chat.messages,
        { id: `m${n++}`, role: 'user', parts: [{ type: 'text', text }] }
      ];
      play();
    },
    async regenerate() {
      if (chat.messages.at(-1)?.role === 'assistant') chat.messages = chat.messages.slice(0, -1);
      play();
    },
    stop: vi.fn(),
    clearError() {
      chat.error = undefined;
    }
  };
  function play() {
    const a = answer();
    chat.error = undefined;
    if (a instanceof Error) {
      chat.error = a;
      chat.status = 'error';
      return;
    }
    chat.messages = [...chat.messages, { id: `m${n++}`, ...a }];
    chat.status = 'ready';
  }
  return {
    chat,
    reset: vi.fn(() => {
      chat.stop();
      chat.messages = [];
      chat.clearError();
    })
  };
}

/** @type {any} */
let user;
/** @type {Record<string, boolean | null> | 'error'} */
let eligible;
/** @type {any} */
let routerAnswer;
/** @type {() => any} */
let searchAnswer;
/** @type {() => any} */
let chatAnswer;
/** @type {import('vitest').Mock} */
let fetchMock;
/** @type {import('vitest').Mock} */
let chatFactory;
/** @type {any[]} */
let chats;

beforeEach(() => {
  _resetTermiEligibilityForTests();
  Object.assign(env.config, {
    termi: { enabled: true, embed: true, llm: true },
    help: { url: '/wiki/edufeed-erste-schritte' },
    discover: { contentTypes: ['events', 'learning', 'articles'] }
  });
  env.runCreateAction.mockClear();
  user = ALICE;
  eligible = { [ALICE.pubkey]: true, [BOB.pubkey]: true };
  routerAnswer = [];
  searchAnswer = () => ({ items: ITEMS, sourcesUnavailable: [] });
  chatAnswer = () => assistantMsg('Hier sind Treffer.', [toolPart('Brüche', ITEMS)]);
  chats = [];
  fetchMock = vi.fn(async (/** @type {string} */ url, /** @type {any} */ init) => {
    if (url.startsWith('/api/termi/eligible')) {
      const pubkey = new URL(url, 'http://x').searchParams.get('pubkey') || '';
      if (eligible === 'error') return new Response('', { status: 500 });
      return new Response(JSON.stringify({ eligible: eligible[pubkey] ?? false, gated: true }));
    }
    if (url === '/api/termi') {
      if (typeof routerAnswer === 'function') return routerAnswer(init);
      return typeof routerAnswer === 'number'
        ? new Response('', { status: routerAnswer })
        : new Response(JSON.stringify({ matches: routerAnswer }));
    }
    if (url === '/api/termi/search') {
      const body = await searchAnswer();
      return body instanceof Response ? body : new Response(JSON.stringify(body));
    }
    return new Response('{}', { status: 404 });
  });
  chatFactory = vi.fn(async () => {
    const c = fakeChat(() => chatAnswer());
    chats.push(c);
    return c;
  });
});
afterEach(() => vi.useRealTimers());

/** @param {Partial<Parameters<typeof createConversation>[0]>} [opts] */
/** @returns {any} the controller, loosely typed: tests poke at the fake chat */
const make = (opts = {}) =>
  createConversation({
    getUser: () => user,
    getLocale: () => 'de',
    fetch: /** @type {any} */ (fetchMock),
    chatFactory: /** @type {any} */ (chatFactory),
    ...opts
  });
/** @param {any} conv */
const lastBot = (conv) => conv.turns.findLast((/** @type {any} */ x) => x.role === 'assistant');
/** The conversation's lines, without ids. @param {any} conv */
const lines = (conv) => conv.turns.map((/** @type {any} */ t) => ({ role: t.role, text: t.text }));
/** @param {any} conv */
const hrefs = (conv) => (lastBot(conv)?.actions ?? []).map((/** @type {any} */ a) => a.href);
const searchBodies = () =>
  fetchMock.mock.calls
    .filter(([u]) => u === '/api/termi/search')
    .map(([, init]) => JSON.parse(String(init.body)));
const probes = () =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).startsWith('/api/termi/eligible'))
    .map(([u]) => new URL(u, 'http://x').searchParams.get('pubkey'));
/** @param {any} conv @param {string} text */
async function answered(conv, text) {
  const before = conv.turns.length;
  expect(conv.ask(text)).toBe(true);
  await until(
    () => !conv.botTyping && conv.turns.length > before && conv.turns.at(-1).role === 'assistant'
  );
}
/** @param {any} conv @param {string} text */
async function chatted(conv, text) {
  conv.ask(text);
  await until(
    () => !!conv.assistant && conv.assistant.chat.status !== 'submitted' && !conv.botTyping
  );
  await flush();
}

describe('router and canned replies', () => {
  beforeEach(() => {
    env.config.termi = { enabled: true, embed: true, llm: false };
  });

  it('flag off: typed text gets the canned fallback after the typing pause, never the router', async () => {
    env.config.termi = { enabled: false, embed: false, llm: false };
    vi.useFakeTimers();
    const conv = make();
    conv.ask('Zur Startseite');
    expect(conv.botTyping).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastBot(conv).text).toBe(m.termi_fallback());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a suggestion chip still gets its canned answer with the flag on', async () => {
    vi.useFakeTimers();
    const conv = make();
    conv.ask(m.termi_sugg_1_q());
    await vi.advanceTimersByTimeAsync(1000);
    expect(lastBot(conv).text).toBe(m.termi_sugg_1_a());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the getting-started chip links the guide; without a HELP_URL there is no such chip', () => {
    expect(make().suggestions[0].link?.attrs.href).toBe('/wiki/edufeed-erste-schritte');
    env.config.help = { url: null };
    expect(make().suggestions.map((/** @type {any} */ s) => s.q)).not.toContain(m.termi_sugg_4_q());
  });

  it('confident navigate → one action to /c/, asked over POST /api/termi', async () => {
    routerAnswer = [
      { skill: 'home', score: 0.92 },
      { skill: 'calendar', score: 0.6 }
    ];
    const conv = make();
    await answered(conv, 'Bring mich heim');
    expect(hrefs(conv)).toEqual(['/c/']);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/termi',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('my-content resolves to the own profile', async () => {
    routerAnswer = [{ skill: 'my-content', score: 0.9 }];
    const conv = make();
    await answered(conv, 'wo sind meine sachen');
    expect(hrefs(conv)).toEqual([`/p/${nip19.npubEncode(ALICE.pubkey)}`]);
  });

  it('maybe → "Meinst du …?" with up to three actions', async () => {
    routerAnswer = [
      { skill: 'calendar', score: 0.78 },
      { skill: 'inbox', score: 0.76 },
      { skill: 'settings', score: 0.74 },
      { skill: 'home', score: 0.73 }
    ];
    const conv = make();
    await answered(conv, 'irgendwas mit terminen');
    expect(lastBot(conv).text).toBe(m.termi_route_maybe());
    expect(hrefs(conv)).toEqual(['/calendar', '/inbox', '/settings']);
  });

  it('"Zeig mir den Kalender" → confident navigate, no content search', async () => {
    routerAnswer = [{ skill: 'calendar', score: 0.95 }];
    const conv = make();
    await answered(conv, 'Zeig mir den Kalender');
    expect(hrefs(conv)).toEqual(['/calendar']);
    expect(searchBodies()).toEqual([]);
  });

  it('a content question goes to tier 1; a weak match only adds a guess beside the cards', async () => {
    routerAnswer = [{ skill: 'my-communities', score: 0.76 }];
    const conv = make();
    await answered(conv, 'ich suche die e-teaching community');
    expect(searchBodies()).toEqual([{ text: 'ich suche die e-teaching community', locale: 'de' }]);
    const reply = lastBot(conv);
    expect(reply.text).toBe(m.termi_route_maybe());
    expect(reply.items).toEqual(ITEMS);
    expect(reply.actions).toHaveLength(1);
  });

  it('tier 1 cards carry the topic for "Alle anzeigen"', async () => {
    const conv = make();
    await answered(conv, Q);
    expect(lastBot(conv)).toMatchObject({ text: m.termi_route_go(), query: 'Brüchen' });
  });

  it('a failed source keeps the note; retry asks tier 1 again with the same text', async () => {
    searchAnswer = () => ({ items: ITEMS, sourcesUnavailable: ['search_events'] });
    const conv = make();
    await answered(conv, 'Welche Fortbildungen gibt es zu OER?');
    expect(lastBot(conv).sourcesUnavailable).toEqual(['search_events']);
    conv.retryOf(lastBot(conv))();
    await until(() => searchBodies().length === 2 && !conv.botTyping);
    expect(searchBodies()[1].text).toBe('Welche Fortbildungen gibt es zu OER?');
    expect(conv.turns.filter((/** @type {any} */ x) => x.items)).toHaveLength(2);
  });

  it('"Material von …" searches by the person key; a name-only person by the name', async () => {
    const pk = 'c'.repeat(64);
    const conv = make();
    await answered(conv, 'Wer schreibt über Mathematik?');
    conv.searchAuthor(
      /** @type {any} */ ({ type: 'person', id: pk, pubkey: pk, title: 'Ada Lovelace' })
    );
    expect(conv.turns.at(-1)).toEqual({
      id: expect.any(String),
      role: 'user',
      tier: 1,
      text: m.termi_card_author_search({ name: 'Ada Lovelace' })
    });
    await until(() => searchBodies().length === 2 && !conv.botTyping);
    expect(searchBodies()[1]).toEqual({ text: 'Ada Lovelace', locale: 'de', authors: [pk] });
    expect(lastBot(conv).query).toBe(''); // by author: no topic, no "Alle anzeigen"
    conv.searchAuthor(
      /** @type {any} */ ({ type: 'person', id: 'name:Grace', title: 'Grace Hopper' })
    );
    await until(() => searchBodies().length === 3);
    expect(searchBodies()[2]).toEqual({ text: 'Grace Hopper', locale: 'de' });
  });

  it('only blocked items: the fallback line, no empty "Hier entlang:"', async () => {
    searchAnswer = () => ({
      items: [{ type: 'resource', id: 'r1', pubkey: 'b'.repeat(64), title: 'Spam', href: '/s' }],
      sourcesUnavailable: []
    });
    const conv = make();
    await answered(conv, 'Material zu Brüchen');
    expect(lastBot(conv).text).toContain(m.termi_nothing_found());
    expect(lastBot(conv).items).toBeUndefined();
  });

  it('off-topic: nothing found → the fallback line plus home, search and help', async () => {
    routerAnswer = [{ skill: 'home', score: 0.2 }];
    searchAnswer = () => ({ items: [], sourcesUnavailable: [] });
    const conv = make();
    await answered(conv, 'Wie wird das Wetter morgen?');
    expect(searchBodies()).toHaveLength(1);
    expect(lastBot(conv).text).toContain(m.termi_nothing_found());
    expect(hrefs(conv)).toEqual(['/c/', '/discover?type=learning', '/wiki/edufeed-erste-schritte']);
  });

  it('keyword path: "hab ich neue nachrichten?" finding nothing → an inbox guess', async () => {
    routerAnswer = 503;
    searchAnswer = () => ({ items: [], sourcesUnavailable: [] });
    const conv = make();
    await answered(conv, 'hab ich neue nachrichten?');
    expect(lastBot(conv).text).toContain(m.termi_route_maybe());
    const inbox = lastBot(conv).actions.find((/** @type {any} */ a) => a.href === '/inbox');
    expect(inbox?.label).toBe(m.termi_route_inbox());
  });

  it.each([
    'hab ich neue nachrichten?',
    'ich suche nach Unterrichtsentwürfen zum Thema Nachhaltigkeit'
  ])('keyword path with cards: a partial phrase match is no guess above them (%s)', async (q) => {
    routerAnswer = 503;
    const conv = make();
    await answered(conv, q);
    expect(lastBot(conv)).toMatchObject({ text: m.termi_route_go(), items: ITEMS });
    expect(lastBot(conv).actions).toBeUndefined();
  });

  it('embed path with cards: the guess shows above them', async () => {
    routerAnswer = [{ skill: 'inbox', score: 0.75 }];
    const conv = make();
    await answered(conv, 'hab ich neue nachrichten?');
    expect(lastBot(conv).text).toBe(m.termi_route_maybe());
    expect(hrefs(conv)).toContain('/inbox');
  });

  it.each([
    ['/api/termi 503', () => (routerAnswer = 503)],
    [
      'a network error',
      () =>
        (routerAnswer = () => {
          throw new TypeError('offline');
        })
    ]
  ])('%s → the keyword path still answers', async (_, arrange) => {
    arrange();
    const conv = make();
    await answered(conv, 'Was ist diese Woche los?');
    expect(hrefs(conv)).toEqual(['/calendar']);
  });

  it('a stalled /api/termi request times out into the keyword answer', async () => {
    vi.useFakeTimers();
    routerAnswer = (/** @type {RequestInit} */ init) =>
      new Promise((_r, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      );
    const conv = make();
    conv.ask('Zeig mir den Kalender');
    expect(conv.botTyping).toBe(true);
    await vi.advanceTimersByTimeAsync(4_100);
    expect(conv.botTyping).toBe(false);
    expect(hrefs(conv)).toEqual(['/calendar']);
  });

  it('create skill action runs the create action', async () => {
    routerAnswer = [{ skill: 'create.article', score: 0.9 }];
    const conv = make();
    await answered(conv, 'Ich will was schreiben');
    const [action] = lastBot(conv).actions;
    expect(action.label).toBe(m.article_fab_write());
    action.run();
    expect(env.runCreateAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'article' }),
      expect.any(Object)
    );
  });

  it('without a help URL the getting-started help skill is never the answer', async () => {
    env.config.help = { url: null };
    routerAnswer = [{ skill: 'help.3', score: 0.95 }];
    searchAnswer = () => ({ items: [], sourcesUnavailable: [] });
    const conv = make();
    await answered(conv, 'Wie fange ich an?');
    expect(lastBot(conv).text).not.toContain(m.termi_sugg_4_a());
    expect(lastBot(conv).text).toContain(m.termi_nothing_found());
  });

  it('while tier 1 runs a second question is not taken', async () => {
    const pending = deferred();
    searchAnswer = () => pending.promise;
    const conv = make();
    conv.ask(Q);
    await until(() => searchBodies().length === 1);
    expect(conv.botTyping).toBe(true);
    expect(conv.ask('Noch eine Frage')).toBe(false);
    pending.resolve({ items: ITEMS, sourcesUnavailable: [] });
    await until(() => !conv.botTyping);
    expect(conv.turns.map((/** @type {any} */ x) => x.role)).toEqual(['user', 'assistant']);
    expect(searchBodies()).toHaveLength(1);
  });
});

describe('the NIP-05 gate', () => {
  it('not eligible → tier 1 instead, no chat; the probe runs once per pubkey', async () => {
    eligible = { [ALICE.pubkey]: false };
    searchAnswer = () => ({ items: [], sourcesUnavailable: [] });
    const conv = make();
    await answered(conv, Q);
    expect(hrefs(conv)).toContain('/discover?type=learning');
    await answered(conv, Q);
    expect(chatFactory).not.toHaveBeenCalled();
    expect(probes()).toEqual([ALICE.pubkey]);
  });

  it('not eligible, a series request → one line why, then tier 1 material; an ask question gets no such line', async () => {
    eligible = { [ALICE.pubkey]: false };
    const conv = make();
    await answered(conv, 'Ich möchte eine Unterrichtsreihe zu Brüchen planen');
    expect(chatFactory).not.toHaveBeenCalled();
    const texts = conv.turns.map((/** @type {any} */ t) => t.text);
    expect(
      texts.filter((/** @type {string} */ t) => t === m.termi_lesson_needs_assistant())
    ).toHaveLength(1);
    expect(texts.indexOf(m.termi_lesson_needs_assistant())).toBe(1);
    expect(conv.turns.at(-1)?.items?.length).toBeGreaterThan(0);
    const ask = make();
    await answered(ask, Q);
    expect(ask.turns.map((/** @type {any} */ t) => t.text)).not.toContain(
      m.termi_lesson_needs_assistant()
    );
  });

  it.each([
    [{ [ALICE.pubkey]: null }, 'undetermined'],
    ['error', 'probe failed']
  ])('probe %o (%s) → not eligible, no error', async (answer, _label) => {
    eligible = /** @type {any} */ (answer);
    const conv = make();
    await answered(conv, Q);
    expect(chatFactory).not.toHaveBeenCalled();
    expect(conv.assistant).toBeNull();
  });

  it('a readonly account gets no assistant, without a probe', async () => {
    user = { pubkey: ALICE.pubkey, type: 'readonly' };
    const conv = make();
    await answered(conv, Q);
    expect(chatFactory).not.toHaveBeenCalled();
    expect(probes()).toEqual([]);
  });

  it('eligible → the `ask` chat starts with the question as its first message', async () => {
    const conv = make();
    await chatted(conv, Q);
    expect(chatFactory).toHaveBeenCalledWith(expect.objectContaining({ task: 'ask', user: ALICE }));
    expect(conv.assistant.chat.messages[0].parts[0].text).toBe(Q);
    // The question shows once: as the router turn, never again from the chat.
    expect(lines(conv)).toEqual([
      { role: 'user', text: Q },
      { role: 'assistant', text: 'Hier sind Treffer.' }
    ]);
    expect(conv.turns.map((/** @type {any} */ t) => t.tier)).toEqual([1, 2]);
  });

  it('the probe runs alongside the router request, not before it', async () => {
    const probe = deferred();
    const base = fetchMock.getMockImplementation();
    /** @type {string[]} */
    const order = [];
    fetchMock.mockImplementation((/** @type {string} */ url, /** @type {any} */ init) => {
      order.push(url.split('?')[0]);
      return url.startsWith('/api/termi/eligible') ? probe.promise : base?.(url, init);
    });
    const conv = make();
    conv.ask(Q);
    await until(() => order.length === 2);
    expect(order).toEqual(['/api/termi/eligible', '/api/termi']);
    probe.resolve(new Response(JSON.stringify({ eligible: true, gated: true })));
    await until(() => !!conv.assistant);
  });

  it('an account switch while the start probe is in flight drops the start silently', async () => {
    const probe = deferred();
    const base = fetchMock.getMockImplementation();
    // only the first probe answers; a probe as the new account would never settle
    fetchMock.mockImplementation((/** @type {string} */ url, /** @type {any} */ init) =>
      url.startsWith('/api/termi/eligible')
        ? probes().length === 1
          ? probe.promise
          : new Promise(() => {})
        : base?.(url, init)
    );
    const conv = make();
    conv.ask(Q);
    await flush();
    user = BOB;
    probe.resolve(new Response(JSON.stringify({ eligible: true, gated: true })));
    await new Promise((r) => setTimeout(r, 50));
    expect(chatFactory).not.toHaveBeenCalled();
    expect(conv.assistant).toBeNull();
    expect(lines(conv)).toEqual([{ role: 'user', text: Q }]);
    expect(conv.botTyping).toBe(false);
    expect(conv.chatBusy).toBe(false);
  });

  it('an account switch while the chat module loads: no chat, no stuck typing, the next question is taken', async () => {
    const loading = deferred();
    chatFactory.mockImplementationOnce(() => loading.promise);
    const conv = make();
    conv.ask(Q);
    await until(() => chatFactory.mock.calls.length === 1);
    expect(conv.botTyping).toBe(true);
    user = BOB;
    loading.resolve(fakeChat(() => chatAnswer()));
    await flush();
    expect(conv.assistant).toBeNull();
    expect(conv.botTyping).toBe(false);
    expect(conv.chatBusy).toBe(false);
    expect(conv.ask('Noch eine Frage')).toBe(true);
  });
});

describe('the tier-2 chat', () => {
  it('later input goes to the chat; restart returns to router mode', async () => {
    const conv = make();
    await chatted(conv, Q);
    expect(conv.ask('Nur für Klasse 6')).toBe(true);
    await flush();
    const sent = conv.assistant.chat.messages.filter((/** @type {any} */ x) => x.role === 'user');
    expect(sent).toHaveLength(2);
    conv.restart();
    expect(conv.assistant).toBeNull();
    expect(conv.turns).toEqual([]);
    expect(chats[0].reset).toHaveBeenCalled();
  });

  it('a lesson sentence starts the chat with task lesson; a follow-up never re-routes; restart resets', async () => {
    const conv = make();
    expect(conv.task).toBe('ask');
    await chatted(conv, 'Ich möchte eine Unterrichtsreihe zu Brüchen planen');
    expect(chatFactory).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'lesson', user: ALICE })
    );
    expect(conv.task).toBe('lesson');
    conv.ask('Was ist eigentlich ein Bruch?');
    await flush();
    expect(chatFactory).toHaveBeenCalledTimes(1);
    expect(conv.task).toBe('lesson');
    conv.restart();
    expect(conv.task).toBe('ask');
    await chatted(conv, Q);
    expect(chatFactory).toHaveBeenLastCalledWith(
      expect.objectContaining({ task: 'ask', user: ALICE })
    );
  });

  it('an eligible lesson sentence skips the router: no create reply, a lesson chat', async () => {
    routerAnswer = [{ skill: 'create.publication', score: 0.95 }];
    const conv = make();
    await chatted(conv, 'Unterrichtsreihe Brüche als Publikation anlegen');
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/termi')).toBe(false);
    expect(chatFactory).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'lesson', user: ALICE })
    );
    expect(conv.turns.filter((/** @type {any} */ t) => t.actions?.length)).toEqual([]);
  });

  it('a busy chat does not take the text', async () => {
    const conv = make();
    await chatted(conv, Q);
    conv.assistant.chat.status = 'streaming';
    expect(conv.ask('Noch was')).toBe(false);
  });

  it.each([
    [503, () => m.termi_assistant_unavailable()],
    [403, () => m.termi_assistant_not_eligible()]
  ])(
    'HTTP %i → its line with tier-1 cards for the same sentence, back to router mode',
    async (status, line) => {
      chatAnswer = () => httpError(status);
      const conv = make();
      conv.ask(Q);
      await until(() => conv.turns.length === 2 && !conv.botTyping);
      expect(conv.assistant).toBeNull();
      expect(lastBot(conv)).toMatchObject({ text: line(), items: ITEMS });
      expect(searchBodies()).toEqual([{ text: Q, locale: 'de' }]);
    }
  );

  it('HTTP 503 with nothing found → the line plus the learning search for the topic', async () => {
    chatAnswer = () => httpError(503);
    searchAnswer = () => ({ items: [], sourcesUnavailable: [] });
    const conv = make();
    conv.ask(Q);
    await until(() => conv.turns.length === 2 && !conv.botTyping);
    expect(lastBot(conv).text).toBe(m.termi_assistant_unavailable());
    expect(hrefs(conv)).toEqual(['/discover?type=learning&search=Br%C3%BCchen']);
  });

  it('fallback with an unreachable source keeps the sources note and the retry', async () => {
    chatAnswer = () => httpError(503);
    searchAnswer = () => ({ items: [], sourcesUnavailable: ['search_events'] });
    const conv = make();
    conv.ask(Q);
    await until(() => conv.turns.length === 2 && !conv.botTyping);
    expect(lastBot(conv)).toMatchObject({
      text: m.termi_assistant_unavailable(),
      sourcesUnavailable: ['search_events']
    });
    expect(typeof conv.retryOf(lastBot(conv))).toBe('function');
    expect(hrefs(conv)).toEqual(['/discover?type=learning&search=Br%C3%BCchen']);
  });

  it('403 is remembered: the next question gets no chat', async () => {
    chatAnswer = () => httpError(403);
    const conv = make();
    conv.ask(Q);
    await until(() => conv.turns.length === 2 && !conv.botTyping);
    await answered(conv, Q);
    expect(chatFactory).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['429 user quota', () => httpError(429, 'user')],
    ['termi:upstream', () => new Error('termi:upstream')]
  ])('%s → the chat stays, tier 1 rescues the same sentence once', async (_, error) => {
    chatAnswer = error;
    const conv = make();
    await chatted(conv, Q);
    await until(() => !!conv.turns.at(-1).items);
    expect(conv.assistant).not.toBeNull();
    // the error line carries the rescue's cards
    expect(conv.turns.at(-1)).toMatchObject({
      error: { href: '/discover?type=learning&search=Br%C3%BCchen' },
      items: ITEMS,
      sourcesUnavailable: [],
      query: 'Brüchen'
    });
    // retry failing again: still one search
    await conv.talk((/** @type {any} */ chat) => chat.regenerate());
    expect(searchBodies()).toEqual([{ text: Q, locale: 'de' }]);
  });

  it('429 without a scope (busy: another tab) → no rescue', async () => {
    chatAnswer = () => httpError(429);
    const conv = make();
    await chatted(conv, Q);
    expect(conv.chatError?.status).toBe(429);
    expect(conv.turns.at(-1)).toMatchObject({ error: { status: 429 } });
    expect(conv.turns.at(-1).items).toBeUndefined();
    expect(searchBodies()).toEqual([]);
  });

  it('restart while the rescue search runs → no stuck typing state, new questions are routed', async () => {
    const pending = deferred();
    chatAnswer = () => httpError(429, 'user');
    searchAnswer = () => pending.promise;
    const conv = make();
    conv.ask(Q);
    await until(() => searchBodies().length === 1);
    conv.restart();
    pending.resolve({ items: ITEMS, sourcesUnavailable: [] });
    await until(() => !conv.botTyping);
    expect(conv.turns).toEqual([]);
    const routed = () => fetchMock.mock.calls.filter(([u]) => u === '/api/termi').length;
    expect(conv.ask('Noch eine Frage')).toBe(true);
    await until(() => routed() === 2);
  });

  it('an account switch during the fallback search drops its answer', async () => {
    const pending = deferred();
    chatAnswer = () => httpError(403);
    searchAnswer = () => pending.promise;
    const conv = make();
    conv.ask(Q);
    await until(() => searchBodies().length === 1);
    user = BOB;
    pending.resolve({ items: ITEMS, sourcesUnavailable: [] });
    await until(() => !conv.botTyping);
    expect(lines(conv)).toEqual([{ role: 'user', text: Q }]);
  });

  it('an account switch ends the chat (syncAccount); the same account keeps it', async () => {
    const onRestart = vi.fn();
    const conv = make({ onRestart });
    await chatted(conv, Q);
    conv.syncAccount(ALICE.pubkey);
    expect(conv.assistant).not.toBeNull();
    conv.syncAccount(BOB.pubkey);
    expect(conv.assistant).toBeNull();
    expect(conv.turns).toEqual([]);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('dispose stops the chat; a start still loading the chat module never sends', async () => {
    const conv = make();
    await chatted(conv, Q);
    conv.dispose();
    expect(chats[0].chat.stop).toHaveBeenCalled();

    const gate = deferred();
    chatFactory.mockImplementationOnce(async () => {
      await gate.promise;
      return fakeChat(() => chatAnswer());
    });
    const late = make();
    late.ask(Q);
    await until(() => chatFactory.mock.calls.length === 2);
    late.dispose();
    gate.resolve();
    await flush();
    expect(late.assistant).toBeNull();
  });

  it('"Material von …" in the chat sends the label with the person key through the window', async () => {
    const conv = make();
    await chatted(conv, Q);
    const send = vi.fn();
    const pk = 'c'.repeat(64);
    conv.searchAuthor(
      /** @type {any} */ ({ type: 'person', id: pk, pubkey: pk, title: 'Ada' }),
      send
    );
    expect(send).toHaveBeenCalledWith(`${m.termi_card_author_search({ name: 'Ada' })} (${pk})`);
  });
});

describe('reading the chat answer', () => {
  /** @param {any} conv */
  const last = (conv) => conv.turns.at(-1);
  /** @param {any[] | undefined} actions */
  const hrefsOf = (actions) => (actions ?? []).map((/** @type {any} */ a) => a.href);
  const failedSearch = () =>
    assistantMsg('', [
      { type: 'dynamic-tool', toolName: 'search_resources', toolCallId: 'e', state: 'output-error' }
    ]);

  it('an answer with neither text nor items is empty: the fallback with the routed guess', async () => {
    routerAnswer = [{ skill: 'inbox', score: 0.75 }];
    chatAnswer = () => assistantMsg('', [toolPart('nachrichten', [])]);
    const conv = make();
    await chatted(conv, 'hab ich neue nachrichten?');
    expect(last(conv).text).toContain(m.termi_nothing_found());
    expect(hrefsOf(last(conv).actions)).toContain('/inbox');
    expect(last(conv).guesses).toBeUndefined();
  });

  it('a text answer beside a routed guess: the strict guess list; follow-ups get none', async () => {
    routerAnswer = [{ skill: 'inbox', score: 0.75 }];
    chatAnswer = () => assistantMsg('Nachrichten findest du …');
    const conv = make();
    await chatted(conv, 'hab ich neue nachrichten?');
    expect(last(conv).text).toBe('Nachrichten findest du …');
    expect(hrefsOf(last(conv).guesses)).toEqual(['/inbox']);
    conv.ask('Und sonst?');
    await flush();
    expect(last(conv).guesses).toBeUndefined();
  });

  it('show_pages: a page action per known id; no "nothing found" without text', async () => {
    chatAnswer = () =>
      assistantMsg('', [
        {
          type: 'dynamic-tool',
          toolName: 'show_pages',
          toolCallId: 'p1',
          state: 'output-available',
          input: { ids: ['inbox', 'nope'] },
          output: { ids: ['inbox', 'nope'] }
        }
      ]);
    const conv = make();
    await chatted(conv, 'welche neuen nachrichten habe ich?');
    expect(hrefsOf(last(conv).actions)).toEqual(['/inbox']);
    expect(last(conv).text).toBe('');
  });

  it('a finished propose_options part becomes turn.options on the latest assistant turn only', async () => {
    const optionsPart = (/** @type {string} */ id, /** @type {string} */ label) => ({
      type: 'dynamic-tool',
      toolName: 'propose_options',
      toolCallId: id,
      state: 'output-available',
      input: {},
      output: {
        question: 'Welches Bundesland?',
        options: [
          { id: 'nrw', label },
          { id: 'nrw', label: 'doppelt' }
        ]
      }
    });
    chatAnswer = () => assistantMsg('', [optionsPart('o1', 'Bayern'), optionsPart('o2', 'NRW')]);
    const conv = make();
    await chatted(conv, 'Ich plane eine Reihe zu Brüchen');
    const first = last(conv);
    // no text, only a card: never the "nothing found" fallback; the last call wins, deduped
    expect(first.text).toBe('');
    expect(first.options).toEqual({
      question: 'Welches Bundesland?',
      options: [{ id: 'nrw', label: 'NRW' }],
      multi: false
    });
    expect(conv.canPick(first)).toBe(true);
    chatAnswer = () => assistantMsg('Danke.');
    conv.ask('NRW');
    await flush();
    const older = conv.turns.find((/** @type {any} */ t) => t.id === first.id);
    expect(older.options).toBeDefined();
    expect(conv.canPick(older)).toBe(false);
    expect(last(conv).options).toBeUndefined();
    expect(conv.canPick(last(conv))).toBe(false);
  });

  it('a failed search without model text gets its own note, not the empty fallback', async () => {
    chatAnswer = failedSearch;
    const conv = make();
    await chatted(conv, Q);
    expect(last(conv).text).toBe(m.termi_search_failed());
    expect(hrefsOf(last(conv).actions)).toEqual(['/discover?type=learning&search=Br%C3%BCchen']);
  });

  it('search failed + a strong guess: both the note and the guess', async () => {
    routerAnswer = [{ skill: 'inbox', score: 0.75 }];
    chatAnswer = failedSearch;
    const conv = make();
    await chatted(conv, 'hab ich neue nachrichten?');
    expect(last(conv).text).toBe(m.termi_search_failed());
    expect(hrefsOf(last(conv).guesses)).toEqual(['/inbox']);
  });

  it('an unknown tool gives no cards; its text answer shows', async () => {
    chatAnswer = () => assistantMsg('Hallo', [toolPart('x', ITEMS, 'something_else')]);
    const conv = make();
    await chatted(conv, Q);
    expect(last(conv)).toMatchObject({ role: 'assistant', text: 'Hallo' });
    expect(last(conv).items).toBeUndefined();
  });

  it('only the latest answer is the retry target; the chat query comes from the last question', async () => {
    const conv = make();
    await chatted(conv, Q);
    const first = last(conv);
    expect(typeof conv.retryOf(first)).toBe('function');
    chatAnswer = failedSearch;
    conv.ask('Und Material zu Geometrie?');
    await flush();
    expect(conv.retryOf(first)).toBeUndefined();
    expect(hrefsOf(last(conv).actions)).toEqual([
      '/discover?type=learning&search=Und%20Material%20zu%20Geometrie'
    ]);
  });
});

describe('history', () => {
  /** @param {any} [conversation] */
  function makeStore(conversation = null) {
    return {
      list: [],
      current: /** @type {any} */ (null),
      refresh: vi.fn(async () => {}),
      open: vi.fn(async () => conversation),
      startNew: vi.fn(),
      record: vi.fn((/** @type {any[]} */ _turns, /** @type {any} */ _meta) => {}),
      remove: vi.fn(async () => {}),
      dispose: vi.fn()
    };
  }
  /** @type {ReturnType<typeof makeStore>} */
  let store;
  /** @type {string[]} */
  let scopes;
  const loadHistoryStore = async () => ({
    createConversationStore: (/** @type {any} */ { scope }) => {
      scopes.push(scope);
      return store;
    },
    createRelaySync: () => ({})
  });
  beforeEach(() => {
    store = makeStore();
    scopes = [];
  });
  /** @param {string} [scope] */
  async function connected(scope = ALICE.pubkey) {
    const conv = make({ loadHistoryStore: /** @type {any} */ (loadHistoryStore) });
    const close = conv.connectHistory(scope, user);
    await conv.historyReady;
    return { conv, close };
  }
  /** One routed tier-2 exchange, recorded as the window's effect would. @param {any} conv @param {string} q */
  async function exchange(conv, q) {
    conv.ask(q);
    conv.observeChatStatus(conv.assistant?.chat.status ?? 'submitted');
    conv.observeChatStatus('streaming');
    await until(
      () => !!conv.assistant && conv.assistant.chat.messages.at(-1)?.role === 'assistant'
    );
    conv.observeChatStatus(conv.assistant.chat.status);
  }

  it('anonymous: scope "anon"; a tier-1 reply records the question and the cards', async () => {
    user = null;
    const { conv } = await connected('anon');
    expect(scopes).toEqual(['anon']);
    await answered(conv, 'Finde Material zu Brüchen');
    const turns = /** @type {any[]} */ (store.record.mock.calls.at(-1))[0];
    expect(turns[0]).toEqual({ role: 'user', text: 'Finde Material zu Brüchen', tier: 1 });
    expect(turns[1]).toMatchObject({ role: 'assistant', tier: 1 });
    expect(turns[1].items).toHaveLength(2);
  });

  it('a tier-2 exchange is recorded once: the router question as tier 1, the answer as tier 2 with its tool part', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Finde Brüche');
    expect(store.record).toHaveBeenCalledTimes(1);
    conv.observeChatStatus('ready');
    expect(store.record).toHaveBeenCalledTimes(1);
    const turns = store.record.mock.calls[0][0];
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: 'user', text: 'Finde Brüche', tier: 1 });
    expect(turns[1]).toMatchObject({ role: 'assistant', text: 'Hier sind Treffer.', tier: 2 });
    expect(turns[1].toolParts[0].output.items).toHaveLength(2);
  });

  it('a stored tier-2 conversation opens read-only without a chat: text, cards, first real query', async () => {
    store = makeStore({
      id: 'c7',
      turns: [
        { role: 'user', text: 'Finde Brüche', tier: 2 },
        {
          role: 'assistant',
          text: 'Treffer.',
          tier: 2,
          toolParts: [
            { ...toolPart('', [], 'find_people'), input: { name: 'Anna' } },
            {
              ...toolPart('Brüche', [item(1), item(2)]),
              output: { items: [item(1), item(2)], sourcesUnavailable: ['search_events'] }
            },
            {
              ...toolPart('Bruchrechnen', [item(3)], 'search_resources'),
              output: { items: [item(3)], sourcesUnavailable: ['search_events', 'oersi'] }
            }
          ]
        }
      ]
    });
    const { conv } = await connected();
    expect(await conv.openConversation('c7')).toBe(true);
    expect(conv.assistant).toBeNull();
    expect(conv.turns[0]).toEqual({
      id: expect.any(String),
      role: 'user',
      text: 'Finde Brüche',
      tier: 1
    });
    expect(conv.turns[1]).toMatchObject({
      role: 'assistant',
      text: 'Treffer.',
      items: [item(1), item(2), item(3)],
      sourcesUnavailable: ['search_events', 'oersi'],
      query: 'Brüche'
    });
  });

  it('read-only restore turns stored show_pages ids into page actions', async () => {
    store = makeStore({
      id: 'c3',
      turns: [
        { role: 'user', text: 'Wo ist der Kalender?', tier: 2 },
        {
          role: 'assistant',
          text: 'Hier:',
          tier: 2,
          toolParts: [
            {
              type: 'dynamic-tool',
              toolName: 'show_pages',
              toolCallId: 'p1',
              state: 'output-available',
              output: { ids: ['calendar', 'nope'] }
            }
          ]
        }
      ]
    });
    const { conv } = await connected();
    await conv.openConversation('c3');
    expect(hrefs(conv)).toEqual(['/calendar']);
  });

  it('read-only restore keeps the stored propose_options card, inert', async () => {
    store = makeStore({
      id: 'c4',
      turns: [
        { role: 'user', text: 'Reihe zu Brüchen', tier: 2 },
        {
          role: 'assistant',
          text: 'Welches Bundesland?',
          tier: 2,
          toolParts: [
            {
              type: 'dynamic-tool',
              toolName: 'propose_options',
              toolCallId: 'o1',
              state: 'output-available',
              output: { question: 'Q', options: [{ id: 'by', label: 'Bayern' }], multi: false }
            }
          ]
        }
      ]
    });
    const { conv } = await connected();
    await conv.openConversation('c4');
    const turn = lastBot(conv);
    expect(turn.options?.options).toEqual([{ id: 'by', label: 'Bayern' }]);
    expect(conv.canPick(turn)).toBe(false);
  });

  it('the stored record carries task lesson; newConversation resets it', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Hilf mir bei einer Unterrichtsreihe');
    expect(store.record).toHaveBeenCalledWith(expect.any(Array), { task: 'lesson' });
    conv.newConversation();
    expect(conv.task).toBe('ask');
    await exchange(conv, 'Finde Brüche');
    expect(store.record).toHaveBeenLastCalledWith(expect.any(Array), { task: 'ask' });
  });

  it('a stored lesson conversation opens with its task; a follow-up chat is a lesson chat', async () => {
    store = makeStore({
      id: 'c9',
      task: 'lesson',
      turns: [
        { role: 'user', text: 'Reihe Brüche', tier: 1 },
        { role: 'assistant', text: 'Phase 1: Wer ist deine Klasse?', tier: 2 }
      ]
    });
    const { conv } = await connected();
    // a running ask chat cannot continue a lesson record: read-only, no reuse
    await exchange(conv, 'Finde Brüche');
    await conv.openConversation('c9');
    expect(conv.assistant).toBeNull();
    expect(conv.task).toBe('lesson');
    await chatted(conv, 'Klasse 6, Gymnasium');
    expect(chatFactory).toHaveBeenLastCalledWith(
      expect.objectContaining({ task: 'lesson', user: ALICE })
    );
  });

  it('a stored record without task opens as ask', async () => {
    store = makeStore({ id: 'c8', turns: [{ role: 'user', text: 'x', tier: 1 }] });
    const { conv } = await connected();
    await chatted(conv, 'Unterrichtsreihe Brüche');
    expect(conv.task).toBe('lesson');
    await conv.openConversation('c8');
    expect(conv.task).toBe('ask');
  });

  it('a stored tier-1 conversation restores its first user bubble', async () => {
    store = makeStore({
      id: 'c1',
      turns: [
        { role: 'user', text: 'Bruchrechnen', tier: 1 },
        { role: 'assistant', text: 'Hier:', tier: 1, items: [item(1)], sourcesUnavailable: [] }
      ]
    });
    const { conv } = await connected();
    await conv.openConversation('c1');
    expect(conv.turns.map((/** @type {any} */ x) => x.text)).toEqual(['Bruchrechnen', 'Hier:']);
  });

  it('two stored exchanges continue in a running chat: the first question a window turn, the rest as chat messages, no re-save', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Finde Brüche');
    conv.ask('Nur Klasse 6');
    conv.observeChatStatus('streaming');
    await flush();
    conv.observeChatStatus('ready');
    const turns = /** @type {any[]} */ (store.record.mock.calls.at(-1))[0];
    const stored = fromContent(
      toContent({ id: 'c2', title: 'B', createdAt: 1, updatedAt: 1, turns })
    );
    store.open.mockResolvedValue(stored);
    store.record.mockClear();

    await exchange(conv, 'Erste Frage'); // a fresh window would do the same: a live chat runs
    store.record.mockClear();
    // a non-ready status right before: the restore must not read as a finished answer
    conv.observeChatStatus('streaming');
    await conv.openConversation('c2');
    conv.observeChatStatus(conv.assistant.chat.status);
    expect(store.record).not.toHaveBeenCalled();
    // the question once, as a window turn; the chat's message 0 is never projected
    expect(conv.turns.map((/** @type {any} */ t) => [t.role, t.tier])).toEqual([
      ['user', 1],
      ['assistant', 2],
      ['user', 2],
      ['assistant', 2]
    ]);
    expect(conv.turns[0].text).toBe('Finde Brüche');
    expect(conv.assistant.chat.messages.map((/** @type {any} */ x) => x.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant'
    ]);
    expect(conv.assistant.chat.messages[1].parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'search_content'
    });
  });

  it('newConversation clears the window and the chat and starts a new record', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Erste Frage');
    conv.newConversation();
    expect(conv.turns).toEqual([]);
    expect(conv.assistant).toBeNull();
    expect(store.startNew).toHaveBeenCalled();
  });

  it('removing the current conversation restarts the window', async () => {
    env.config.termi = { enabled: true, embed: true, llm: false };
    const { conv } = await connected();
    await answered(conv, Q);
    /** @type {any} */ (store).current = { id: 'c1' };
    await conv.removeConversation('c1');
    expect(store.remove).toHaveBeenCalledWith('c1');
    expect(conv.turns).toEqual([]);
  });

  it('a 503 on the third question keeps the two earlier exchanges, on screen and in the record', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Erste Frage');
    chatAnswer = () => assistantMsg('Zweite Antwort');
    await exchange(conv, 'Zweite Frage');
    chatAnswer = () => httpError(503);
    store.record.mockClear();
    conv.ask('Dritte Frage');
    await until(() => !conv.assistant && !conv.botTyping && store.record.mock.calls.length > 0);
    const order = [
      'Erste Frage',
      'Hier sind Treffer.',
      'Zweite Frage',
      'Zweite Antwort',
      'Dritte Frage',
      m.termi_assistant_unavailable()
    ];
    expect(lines(conv).map((/** @type {any} */ l) => l.text)).toEqual(order);
    // the first answer's cards stay
    expect(conv.turns[1].items).toHaveLength(2);
    const turns = /** @type {any[]} */ (store.record.mock.calls.at(-1))[0];
    expect(turns.map((/** @type {any} */ t) => t.text)).toEqual(order);
  });

  it('continuing a stored chat with an import between two chat turns: the import stays a window turn, never a chat message', async () => {
    const summary = m.termi_history_import_summary({ n: 1, file: 'plan.xlsx' });
    const stored = {
      id: 'c3',
      title: 'C',
      createdAt: 1,
      updatedAt: 1,
      turns: [
        { role: 'user', text: 'Erste Frage', tier: 1 },
        { role: 'assistant', text: 'Erste Antwort', tier: 2 },
        { role: 'user', text: 'Importiere', tier: 1 },
        { role: 'assistant', text: summary, tier: 1 },
        { role: 'user', text: 'Zweite Frage', tier: 2 },
        { role: 'assistant', text: 'Zweite Antwort', tier: 2 }
      ]
    };
    store.open.mockResolvedValue(stored);
    const { conv } = await connected();
    await exchange(conv, 'Laufend');
    await conv.openConversation('c3');
    const texts = conv.assistant.chat.messages.map(
      (/** @type {any} */ x) => x.parts.find((/** @type {any} */ p) => p.type === 'text')?.text
    );
    expect(texts).toEqual(['Erste Frage', 'Erste Antwort', 'Zweite Frage', 'Zweite Antwort']);
    expect(lines(conv).map((/** @type {any} */ l) => l.text)).toEqual(
      stored.turns.map((t) => t.text)
    );
    expect(conv.turnsNow().map((/** @type {any} */ t) => t.text)).toEqual(
      stored.turns.map((t) => t.text)
    );
  });

  it('an import made during a chat is recorded after it; a failed one leaves no question-only turn', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Erste Frage');
    conv.append({ role: 'user', text: 'kaputt' }, { importOf: true });
    conv.append({
      role: 'assistant',
      text: '',
      import: /** @type {any} */ ({ source: 'a.xlsx', status: 'failed' })
    });
    conv.append({ role: 'user', text: 'Nur Dezember' }, { importOf: true });
    const id = conv.append({
      role: 'assistant',
      text: '',
      import: /** @type {any} */ ({
        source: 'plan.xlsx',
        status: 'extracting',
        instruction: 'Nur Dezember'
      })
    });
    expect(conv.turns.slice(-4).map((/** @type {any} */ t) => t.text)).toEqual([
      'kaputt',
      '',
      'Nur Dezember',
      ''
    ]);
    conv.patchImport(id, { status: 'done', result: { ok: ['k'], failed: [] } });
    conv.saveHistory();
    const turns = /** @type {any[]} */ (store.record.mock.calls.at(-1))[0];
    expect(turns.some((/** @type {any} */ t) => t.text === 'kaputt')).toBe(false);
    expect(turns.at(-3)).toMatchObject({ role: 'assistant', text: 'Hier sind Treffer.', tier: 2 });
    expect(turns.at(-2)).toEqual({ role: 'user', text: 'Nur Dezember', tier: 1 });
    expect(turns.at(-1)).toEqual({
      role: 'assistant',
      text: m.termi_history_import_summary({ n: 1, file: 'plan.xlsx' }),
      tier: 1
    });
    conv.restart();
    expect(conv.turns).toEqual([]);
  });

  it('a failed extraction replaced after the chat grew stays in its slot', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Erste Frage');
    // only the answer turn: its slot must come from its own key, not from a neighbour's
    const id = conv.append({
      role: 'assistant',
      text: '',
      import: /** @type {any} */ ({ source: 'leer.pdf', status: 'extracting' })
    });
    chatAnswer = () => assistantMsg('Zweite Antwort');
    conv.ask('Zweite Frage');
    await until(() => conv.assistant.chat.messages.length === 4);
    conv.replaceImport(id, m.termi_import_no_text());
    const order = [
      'Erste Frage',
      'Hier sind Treffer.',
      m.termi_import_no_text(),
      'Zweite Frage',
      'Zweite Antwort'
    ];
    expect(conv.turns.map((/** @type {any} */ t) => t.text)).toEqual(order);
    expect(conv.turnsNow().map((/** @type {any} */ t) => t.text)).toEqual(order);
  });

  it('chat turn, import turn, chat turn: the import keeps its time position, in turns and turnsNow', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Erste Frage');
    conv.append({ role: 'user', text: 'Importiere' }, { importOf: true });
    conv.append({
      role: 'assistant',
      text: '',
      import: /** @type {any} */ ({
        source: 'plan.xlsx',
        status: 'done',
        instruction: 'Importiere',
        result: { ok: ['k'], failed: [] }
      })
    });
    chatAnswer = () => assistantMsg('Zweite Antwort');
    conv.ask('Zweite Frage');
    await until(() => conv.assistant.chat.messages.length === 4);
    const order = [
      'Erste Frage',
      'Hier sind Treffer.',
      'Importiere',
      'Zweite Frage',
      'Zweite Antwort'
    ];
    expect(
      conv.turns.filter((/** @type {any} */ t) => t.text).map((/** @type {any} */ t) => t.text)
    ).toEqual(order);
    expect(conv.turnsNow().map((/** @type {any} */ t) => t.text)).toEqual([
      ...order.slice(0, 3),
      m.termi_history_import_summary({ n: 1, file: 'plan.xlsx' }),
      ...order.slice(3)
    ]);
  });

  it('an account switch closes the old store, opens the new one and clears the window', async () => {
    env.config.termi = { enabled: true, embed: true, llm: false };
    const { conv, close } = await connected();
    await answered(conv, Q);
    const old = store;
    close();
    expect(old.dispose).toHaveBeenCalled();
    expect(conv.history).toBeNull();
    store = makeStore();
    conv.connectHistory(BOB.pubkey, BOB);
    await conv.historyReady;
    expect(scopes).toEqual([ALICE.pubkey, BOB.pubkey]);
    expect(conv.turns).toEqual([]);
    expect(conv.history).toBe(store);
  });

  it('a store still loading when the window closes is never created', async () => {
    const conv = make({ loadHistoryStore: /** @type {any} */ (loadHistoryStore) });
    conv.connectHistory('anon', null)();
    await conv.historyReady;
    expect(scopes).toEqual([]);
    expect(conv.history).toBeNull();
  });

  it('a tier-1 answer arriving after an account switch is dropped, not recorded', async () => {
    const pending = deferred();
    searchAnswer = () => pending.promise;
    env.config.termi = { enabled: true, embed: true, llm: false };
    const { conv } = await connected();
    conv.ask(Q);
    await until(() => searchBodies().length === 1);
    user = BOB;
    pending.resolve({ items: [item(1)], sourcesUnavailable: [] });
    await until(() => !conv.botTyping);
    expect(lines(conv)).toEqual([{ role: 'user', text: Q }]);
    expect(store.record).not.toHaveBeenCalled();
  });

  it('a saved LiaScript draft is kept on the answer and recorded with it', async () => {
    const { conv } = await connected();
    await exchange(conv, 'Fasse Brüche zusammen');
    const answer = conv.turns.at(-1);
    conv.setArtifacts(answer.id, { draftNaddr: 'naddr1draft' });
    expect(conv.turns.at(-1).artifacts).toEqual({ draftNaddr: 'naddr1draft' });
    expect(
      /** @type {any[]} */ (store.record.mock.calls.at(-1))[0].at(-1).artifacts?.draftNaddr
    ).toBe('naddr1draft');
  });

  it('a draft on a tier-1 answer is kept on its turn and recorded with it', async () => {
    env.config.termi = { enabled: true, embed: true, llm: false };
    const { conv } = await connected();
    await answered(conv, Q);
    conv.setArtifacts(lastBot(conv).id, { draftNaddr: 'naddr1draft' });
    expect(lastBot(conv).artifacts).toEqual({ draftNaddr: 'naddr1draft' });
    expect(
      /** @type {any[]} */ (store.record.mock.calls.at(-1))[0].at(-1).artifacts?.draftNaddr
    ).toBe('naddr1draft');
  });

  describe('lesson state and materials', () => {
    const LESSON_Q = 'Ich möchte eine Unterrichtsreihe zu Brüchen planen';
    const PUB_NADDR = 'naddr1qqqqqqqq';
    /** @param {string} id @param {any} output */
    const statePart = (id, output) => ({
      type: 'tool-lesson_state',
      toolCallId: id,
      state: 'output-available',
      input: output,
      output
    });

    it('a lesson_state output folds into lessonState once (same toolCallId twice → one merge)', async () => {
      chatAnswer = () =>
        assistantMsg('Rahmen steht.', [statePart('s1', { phase: 2, frame: { subject: 'Mathe' } })]);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      expect(conv.lessonState).toMatchObject({ phase: 2, frame: { subject: 'Mathe' } });
      // a later answer moves on; a replayed s1 must not set the phase back
      chatAnswer = () =>
        assistantMsg('Weiter.', [
          statePart('s2', { phase: 3 }),
          statePart('s1', { phase: 2, frame: { subject: 'Mathe' } })
        ]);
      await exchange(conv, 'Ja, passt');
      conv.observeChatStatus('ready');
      expect(conv.lessonState.phase).toBe(3);
      expect(store.record).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.objectContaining({ task: 'lesson', lesson: conv.lessonState })
      );
    });

    it('patchLesson: a client edit survives a later model patch to another field; arrays replace', async () => {
      chatAnswer = () =>
        assistantMsg('Rahmen.', [statePart('s1', { frame: { subject: 'Mathe' } })]);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      expect(conv.patchLesson({ frame: { grade: '5' } })).toBe(true);
      chatAnswer = () => assistantMsg('Weiter.', [statePart('s2', { phase: 2 })]);
      await exchange(conv, 'Ja');
      conv.observeChatStatus('ready');
      expect(conv.lessonState).toMatchObject({
        phase: 2,
        frame: { subject: 'Mathe', grade: '5' }
      });
      conv.patchLesson({ competences: [{ label: 'a' }, { label: 'b' }] });
      conv.patchLesson({ competences: [{ label: 'b' }] });
      expect(conv.lessonState.competences).toEqual([{ label: 'b' }]);
    });

    it('patchLesson works before the model wrote any state; over 16 KB returns false and changes nothing', async () => {
      chatAnswer = () => assistantMsg('Hallo, was unterrichtest du?', []);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      expect(conv.lessonState).toBeNull();
      expect(conv.patchLesson({ frame: { topic: 'T' } })).toBe(true);
      const big = Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`n${i}`, 'x'.repeat(490)])
      );
      expect(conv.patchLesson({ frame: big, didactics: big, parts: { worksheets: big } })).toBe(
        false
      );
      expect(conv.lessonState.frame).toEqual({ topic: 'T' });
    });

    it('a patch that would push the state over 16 KB is dropped; the previous state stays', async () => {
      const { bigLessonState } = await import(
        '../../../__tests__/fixtures/termi/big-lesson-state.js'
      );
      const big = bigLessonState();
      const size = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;
      // ~3.5 KB each: every patch passes the 4 KB patch cap on its own
      const notes = (/** @type {string} */ c) =>
        Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`note${i}`, c.repeat(490)]));
      chatAnswer = () =>
        assistantMsg('Stand.', [
          // the big state, in patches under 4 KB
          statePart('s1', { phase: big.phase, frame: big.frame, didactics: big.didactics }),
          statePart('s2', { competences: big.competences }),
          statePart('s3', { plan: big.plan }),
          statePart('s4', { parts: big.parts }),
          statePart('s5', { frame: notes('x') }),
          statePart('s6', { didactics: notes('y') }),
          statePart('s7', { parts: { worksheets: notes('z') } }),
          // this one would cross 16 KB
          statePart('s8', { parts: { summary: notes('w') } })
        ]);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      expect(warn).toHaveBeenCalledWith('[termi] lesson state over 16 KB, patch dropped');
      warn.mockRestore();
      // ~14 KB: a model patch carries no naddrs (sanitizeLessonPatch drops them)
      expect(size(conv.lessonState)).toBeGreaterThan(13 * 1024);
      expect(size(conv.lessonState)).toBeLessThanOrEqual(16 * 1024);
      expect(conv.lessonState.parts.worksheets).toBeDefined();
      expect(conv.lessonState.parts.summary).toBeUndefined();
      expect(conv.lessonState.parts.lessons).toHaveLength(8);
    });

    it('an invalid patch leaves the state unchanged', async () => {
      chatAnswer = () => assistantMsg('Ok.', [statePart('s1', { phase: 2 })]);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      const before = conv.lessonState;
      chatAnswer = () =>
        assistantMsg('Hm.', [
          statePart('s2', { rejected: true }),
          statePart('s3', 'kaputt'),
          statePart('s4', null)
        ]);
      await exchange(conv, 'Weiter');
      expect(conv.lessonState).toBe(before);
    });

    it('an ask chat never folds lesson_state', async () => {
      chatAnswer = () => assistantMsg('Ok.', [statePart('s1', { phase: 2 })]);
      const { conv } = await connected();
      await exchange(conv, Q);
      expect(conv.lessonState).toBeNull();
    });

    it('a lesson answer projects its parts; an ask answer with the same text does not', async () => {
      const TEXT =
        '<!-- termi:part module -->\n<!--\nauthor:\n-->\n# Modul\n\nA.\n\n<!-- termi:part lesson 2 -->\n# Stunde 2\n\nB.';
      chatAnswer = () => assistantMsg(TEXT);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      const turn = lastBot(conv);
      expect(turn.lessonParts.map((/** @type {any} */ p) => [p.kind, p.n, p.title])).toEqual([
        ['module', undefined, 'Modul'],
        ['lesson', 2, 'Stunde 2']
      ]);
      // only the marker is stripped: the LiaScript header stays first
      expect(turn.lessonParts[0].text.startsWith('<!--\nauthor:')).toBe(true);
      expect(turn.lessonPart).toEqual(turn.lessonParts[0]);
      const ask = await connected();
      await exchange(ask.conv, Q);
      expect(lastBot(ask.conv).lessonParts).toBeUndefined();
    });

    it('recordPartWrap writes the wrap into lessonState.parts and saves', async () => {
      chatAnswer = () =>
        assistantMsg('Ok.', [
          statePart('s1', { phase: 5, parts: { lessons: [{ n: 1, title: 'Eins' }] } })
        ]);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      conv.recordPartWrap('lesson-1', 'naddr1one');
      conv.recordPartWrap('lesson-3', 'naddr1three', 'Drei');
      conv.recordPartWrap('module', 'naddr1mod');
      expect(conv.lessonState.parts).toEqual({
        lessons: [
          { n: 1, title: 'Eins', wrap: 'naddr1one' },
          { n: 3, title: 'Drei', wrap: 'naddr1three' }
        ],
        module: { wrap: 'naddr1mod' }
      });
      expect(store.record).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.objectContaining({ lesson: conv.lessonState })
      );
    });

    it('recordPublished keeps the 30040 in the recorded lesson; a run from an earlier conversation records nothing', async () => {
      chatAnswer = () => assistantMsg('Ok.', [statePart('s1', { phase: 7 })]);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      const id = conv.conversationId();
      conv.recordPublished({ publication: PUB_NADDR }, id);
      expect(store.record).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.objectContaining({ lesson: expect.objectContaining({ publication: PUB_NADDR }) })
      );
      const calls = store.record.mock.calls.length;
      conv.recordPublished({ resource: PUB_NADDR }, 'an-old-conversation');
      conv.recordPartWrap('lesson-1', PUB_NADDR, 'Eins', 'an-old-conversation');
      expect(conv.lessonState.resource).toBeUndefined();
      expect(conv.lessonState.parts.lessons).toEqual([]);
      expect(store.record.mock.calls.length).toBe(calls);
    });

    it('a save that outlives a restart records nothing into the new conversation', async () => {
      chatAnswer = () => assistantMsg('Ok.', [statePart('s1', { phase: 5 })]);
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      const id = conv.conversationId();
      conv.restart();
      await exchange(conv, LESSON_Q);
      conv.recordPartWrap('lesson-1', PUB_NADDR, 'Eins', id);
      expect(conv.lessonState.parts.lessons).toEqual([]);
    });

    it('the first record of a conversation keeps the id a save already used', async () => {
      const { conv } = await connected();
      const id = conv.conversationId();
      await exchange(conv, Q);
      expect(store.record.mock.calls[0][1].id).toBe(id);
    });

    it('replaceTurnText makes a stub chat turn whole again', async () => {
      chatAnswer = () => assistantMsg('<!-- termi:part lesson 1 -->\n# Stu …');
      const { conv } = await connected();
      await exchange(conv, LESSON_Q);
      const id = lastBot(conv).id;
      conv.setArtifacts(id, { draftWraps: { 'lesson-1': 'naddr1wrap' } });
      conv.assistant.chat.messages = conv.assistant.chat.messages.map((/** @type {any} */ x) =>
        x.id === id ? { ...x, metadata: { ...x.metadata, textStub: true } } : x
      );
      expect(lastBot(conv).textStub).toBe(true);
      expect(lastBot(conv).lessonParts).toBeUndefined();
      conv.replaceTurnText(id, '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nGanz.');
      expect(lastBot(conv).textStub).toBeUndefined();
      expect(lastBot(conv).text).toContain('Ganz.');
      expect(lastBot(conv).lessonParts).toHaveLength(1);
      expect(lastBot(conv).artifacts).toEqual({ draftWraps: { 'lesson-1': 'naddr1wrap' } });
    });

    it('addMaterial caps at 3 files and 15 000 chars and replaces a same-named file', () => {
      const conv = make();
      conv.addMaterial({ name: '  Arbeits\n blatt.pdf ', text: 'x'.repeat(20_000) });
      expect(conv.materials).toEqual([{ name: 'Arbeits blatt.pdf', text: 'x'.repeat(15_000) }]);
      conv.addMaterial({ name: 'b', text: 'b' });
      conv.addMaterial({ name: 'c', text: 'c' });
      conv.addMaterial({ name: 'b', text: 'neu' });
      expect(conv.materials.map((/** @type {any} */ f) => [f.name, f.text.slice(0, 3)])).toEqual([
        ['Arbeits blatt.pdf', 'xxx'],
        ['b', 'neu'],
        ['c', 'c']
      ]);
    });

    it('a 4th material replaces the oldest', () => {
      const conv = make();
      for (const n of ['a', 'b', 'c', 'd']) conv.addMaterial({ name: n, text: n });
      expect(conv.materials.map((/** @type {any} */ f) => f.name)).toEqual(['b', 'c', 'd']);
    });

    it('getBodyExtras is empty for ask and carries lesson+materials for lesson', async () => {
      const conv = make();
      expect(conv.getBodyExtras()).toEqual({});
      chatAnswer = () => assistantMsg('Ok.', [statePart('s1', { phase: 2 })]);
      await chatted(conv, LESSON_Q);
      // the factory gets the controller's own reader
      expect(chatFactory.mock.calls[0][0].getBodyExtras).toBe(conv.getBodyExtras);
      expect(conv.getBodyExtras()).toEqual({
        lesson: expect.objectContaining({ phase: 2 }),
        materials: undefined,
        locale: 'de'
      });
      conv.addMaterial({ name: 'a.pdf', text: 'Text' });
      expect(conv.getBodyExtras().materials).toEqual([{ name: 'a.pdf', text: 'Text' }]);
      conv.restart();
      expect(conv.lessonState).toBeNull();
      expect(conv.materials).toEqual([]);
      expect(conv.getBodyExtras()).toEqual({});
    });

    const lessonRecord = () => ({
      id: 'c5',
      task: 'lesson',
      lesson: {
        phase: 3,
        frame: { subject: 'Mathe' },
        competences: [],
        didactics: {},
        plan: [],
        parts: { lessons: [] }
      },
      materials: [{ name: 'a.pdf', text: 'Text' }],
      turns: [
        { role: 'user', text: 'Reihe Brüche', tier: 1 },
        {
          role: 'assistant',
          text: 'Phase 1 fertig.',
          tier: 2,
          toolParts: [
            {
              type: 'dynamic-tool',
              toolName: 'lesson_state',
              toolCallId: 'old',
              state: 'output-available',
              output: { phase: 2 }
            }
          ]
        }
      ]
    });

    it('opening a stored lesson conversation without a running chat starts a lesson chat and restores phase 3', async () => {
      store = makeStore(lessonRecord());
      const { conv } = await connected();
      await conv.openConversation('c5');
      expect(conv.assistant).toBeNull();
      expect(conv.task).toBe('lesson');
      expect(conv.lessonState.phase).toBe(3);
      expect(conv.materials).toEqual([{ name: 'a.pdf', text: 'Text' }]);
      await chatted(conv, 'weiter');
      expect(chatFactory).toHaveBeenLastCalledWith(
        expect.objectContaining({ task: 'lesson', user: ALICE })
      );
      // the stored lesson_state is already in the state: not folded again
      expect(conv.lessonState.phase).toBe(3);
    });

    it("resume: openConversation(lesson record) then ask('weiter') → chat seeded with the stored turns before the new one", async () => {
      store = makeStore(lessonRecord());
      const { conv } = await connected();
      await conv.openConversation('c5');
      await chatted(conv, 'weiter');
      const msgs = conv.assistant.chat.messages;
      expect(msgs.map((/** @type {any} */ x) => [x.role, x.parts.at(-1)?.text])).toEqual([
        ['user', 'Reihe Brüche'],
        ['assistant', 'Phase 1 fertig.'],
        ['user', 'weiter'],
        ['assistant', 'Hier sind Treffer.']
      ]);
      // the window shows 'weiter' once
      expect(lines(conv).filter((/** @type {any} */ l) => l.text === 'weiter')).toHaveLength(1);
      expect(lines(conv)[0]).toEqual({ role: 'user', text: 'Reihe Brüche' });
    });

    it('an account switch drops a pending resume', async () => {
      store = makeStore(lessonRecord());
      const { conv } = await connected();
      await conv.openConversation('c5');
      user = BOB;
      conv.syncAccount(BOB.pubkey);
      expect(conv.lessonState).toBeNull();
      expect(conv.task).toBe('ask');
      expect(conv.turns).toEqual([]);
    });

    it('an account switch while open() is pending: nothing restored, no resume, nothing saved into the new account', async () => {
      const pending = deferred();
      store = makeStore();
      store.open.mockReturnValue(pending.promise);
      const { conv } = await connected();
      const opened = conv.openConversation('c5');
      user = BOB;
      store = makeStore(); // the new account's store
      conv.connectHistory(BOB.pubkey, BOB);
      await conv.historyReady;
      pending.resolve(lessonRecord());
      expect(await opened).toBe(false);
      expect(conv.turns).toEqual([]);
      expect(conv.lessonState).toBeNull();
      expect(conv.task).toBe('ask');
      await answered(conv, 'Finde Material zu Brüchen');
      expect(chatFactory).not.toHaveBeenCalledWith(expect.objectContaining({ task: 'lesson' }));
      for (const [turns] of store.record.mock.calls)
        expect(turns.map((/** @type {any} */ t) => t.text)).not.toContain('Reihe Brüche');
    });

    it('a refused resume keeps its tier-1 exchange: a later allowed start is seeded from the record as saved', async () => {
      store = makeStore(lessonRecord());
      store.open.mockImplementation(
        async () => (store.current = /** @type {any} */ (lessonRecord()))
      );
      store.record.mockImplementation((/** @type {any[]} */ turns, /** @type {any} */ meta) => {
        store.current = { ...store.current, ...meta, turns };
      });
      eligible = { [ALICE.pubkey]: false };
      const { conv } = await connected();
      await conv.openConversation('c5');
      await answered(conv, 'weiter');
      const saved = /** @type {any[]} */ (store.record.mock.calls.at(-1))[0];
      // the record keeps its tier-2 answer and gains the refused exchange
      expect(saved.map((/** @type {any} */ t) => [t.role, t.tier, t.text])).toEqual([
        ['user', 1, 'Reihe Brüche'],
        ['assistant', 2, 'Phase 1 fertig.'],
        ['user', 1, 'weiter'],
        ['assistant', 1, m.termi_assistant_not_eligible()]
      ]);
      expect(saved[1].toolParts[0].toolName).toBe('lesson_state');

      _resetTermiEligibilityForTests();
      eligible = { [ALICE.pubkey]: true };
      await chatted(conv, 'jetzt aber');
      expect(chatFactory).toHaveBeenLastCalledWith(expect.objectContaining({ task: 'lesson' }));
      expect(
        conv.assistant.chat.messages.map((/** @type {any} */ x) => x.parts.at(-1)?.text)
      ).toEqual(['Reihe Brüche', 'Phase 1 fertig.', 'jetzt aber', 'Hier sind Treffer.']);
      expect(lines(conv).map((/** @type {any} */ l) => l.text)).toEqual([
        'Reihe Brüche',
        'Phase 1 fertig.',
        'weiter',
        m.termi_assistant_not_eligible(),
        'jetzt aber',
        'Hier sind Treffer.'
      ]);
      conv.saveHistory();
      const after = /** @type {any[]} */ (store.record.mock.calls.at(-1))[0];
      expect(after.map((/** @type {any} */ t) => t.text)).toContain('weiter');
      expect(after.at(-1)).toMatchObject({ tier: 2, text: 'Hier sind Treffer.' });
    });
  });
});
