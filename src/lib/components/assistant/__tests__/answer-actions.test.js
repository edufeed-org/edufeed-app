/** @vitest-environment node */
// The answer-action contract: document actions as ANSWER_ACTIONS entries, their
// UI state in the conversation controller keyed by turn id, and show_pages
// buttons from the tool registry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import * as m from '$lib/paraglide/messages';

overwriteGetLocale(() => 'de');

vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/helpers/run-create-action.js', () => ({ runCreateAction: vi.fn() }));
const createArticle = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/article-actions.svelte.js', () => ({ createArticle }));
const drafts = vi.hoisted(() => ({
  saveLessonDraft: vi.fn(),
  loadLessonDraft: vi.fn(),
  previewAsPlaintext: vi.fn()
}));
vi.mock('$lib/stores/lesson-drafts.svelte.js', () => drafts);

const { ANSWER_ACTIONS, actionsFor, runAnswerAction } = await import('../answer-actions.js');
const { createConversation } = await import('../termi-conversation.svelte.js');
const { TOOL_REGISTRY, toolActions } = await import('$lib/termi/tool-registry.js');
const { lessonPartsOf } = await import('$lib/termi/lesson-state.js');

const DOC = '# Titel\n\n## Abschnitt\n\nText.';
const USER = { pubkey: 'a'.repeat(64), type: 'nsec', signer: {} };
const action = (/** @type {string} */ id) =>
  /** @type {import('../answer-actions.js').AnswerAction} */ (
    ANSWER_ACTIONS.find((a) => a.id === id)
  );

/** A controller-backed ctx, as the window builds it. @param {any} [user] */
function setup(user = USER) {
  const conv = createConversation({ getUser: () => user });
  /** @type {import('../answer-actions.js').AnswerActionCtx} */
  const ctx = {
    user,
    locale: 'de',
    close: vi.fn(),
    getState: conv.actionStateOf,
    setState: conv.setActionState,
    setArtifacts: conv.setArtifacts
  };
  return { conv, ctx };
}
/** @param {ReturnType<typeof createConversation>} conv @param {string} text */
const answer = (conv, text = DOC) => {
  const id = conv.append({ role: 'assistant', text });
  return /** @type {any} */ (conv.turns.find((t) => t.id === id));
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  createArticle.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('which actions a turn offers', () => {
  it('a document answer: copy, download, article, liascript; logged out only copy and download', () => {
    const { conv, ctx } = setup();
    const turn = answer(conv);
    expect(actionsFor(turn, ctx).map((a) => a.id)).toEqual([
      'copy',
      'download',
      'article',
      'liascript'
    ]);
    expect(actionsFor(turn, { ...ctx, user: null }).map((a) => a.id)).toEqual(['copy', 'download']);
  });

  it('none for a short answer, a streaming one, a capped one or a question', () => {
    const { conv, ctx } = setup();
    const turn = answer(conv);
    expect(actionsFor(answer(conv, 'Hier sind Treffer.'), ctx)).toEqual([]);
    expect(actionsFor({ ...turn, pending: true }, ctx)).toEqual([]);
    expect(actionsFor({ ...turn, sourcesLost: true }, ctx)).toEqual([]);
    expect(actionsFor({ ...turn, role: 'user' }, ctx)).toEqual([]);
  });
});

describe('copy', () => {
  it('two turns with the same text keep their own "Kopiert" state, for 2 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { conv, ctx } = setup();
    const a = answer(conv);
    const b = answer(conv);
    await runAnswerAction(a, action('copy'), ctx);
    expect(writeText).toHaveBeenCalledWith(DOC);
    expect(conv.actionStateOf(a.id, 'copy')).toEqual({ ok: true });
    expect(conv.actionStateOf(b.id, 'copy')).toBeUndefined();
    expect(action('copy').label(ctx, conv.actionStateOf(a.id, 'copy'))).toBe(m.termi_doc_copied());
    expect(action('copy').label(ctx, conv.actionStateOf(b.id, 'copy'))).toBe(m.termi_doc_copy());
    vi.advanceTimersByTime(2000);
    expect(conv.actionStateOf(a.id, 'copy')).toBeUndefined();
  });

  it('a refused clipboard reads "Kopieren nicht möglich"', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        }
      }
    });
    const { conv, ctx } = setup();
    const a = answer(conv);
    await runAnswerAction(a, action('copy'), ctx);
    expect(action('copy').label(ctx, conv.actionStateOf(a.id, 'copy'))).toBe(
      m.termi_doc_copy_failed()
    );
  });
});

describe('liascript', () => {
  /** @type {{ location: { href: string }, opener: any, close: any }} */
  let tab;
  beforeEach(() => {
    tab = { location: { href: 'about:blank' }, opener: {}, close: vi.fn() };
    vi.stubGlobal('window', { open: vi.fn(() => tab) });
  });

  it('reuses the turn’s saved draft: no second publish', async () => {
    const { conv, ctx } = setup();
    const turn = { ...answer(conv), artifacts: { draftNaddr: 'naddr1saved' } };
    await runAnswerAction(turn, action('liascript'), ctx);
    expect(createArticle).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      'https://liascript.github.io/course/?nostr:naddr1saved',
      '_blank',
      'noopener'
    );
  });

  it('busy until the draft is on a relay, then its naddr is kept on the turn', async () => {
    /** @type {(v: any) => void} */
    let accept = () => {};
    createArticle.mockReturnValue(new Promise((r) => (accept = r)));
    const { conv, ctx } = setup();
    const turn = answer(conv);
    const run = runAnswerAction(turn, action('liascript'), ctx);
    await flush();
    expect(conv.actionStateOf(turn.id, 'liascript')).toEqual({ busy: true });
    // a second click while busy does nothing
    await runAnswerAction(turn, action('liascript'), ctx);
    accept({ naddr: 'naddr1draft' });
    await run;
    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://liascript.github.io/course/?nostr:naddr1draft');
    expect(conv.actionStateOf(turn.id, 'liascript')).toBeUndefined();
    expect(conv.turns.find((t) => t.id === turn.id)?.artifacts).toEqual({
      draftNaddr: 'naddr1draft'
    });
  });

  it('a failed publish closes the tab and leaves only that turn failed', async () => {
    createArticle.mockRejectedValue(new Error('publish_failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { conv, ctx } = setup();
    const a = answer(conv);
    const b = answer(conv);
    await runAnswerAction(a, action('liascript'), ctx);
    expect(tab.close).toHaveBeenCalled();
    expect(conv.actionStateOf(a.id, 'liascript')).toEqual({ failed: true });
    expect(conv.actionStateOf(b.id, 'liascript')).toBeUndefined();
    expect(conv.turns.find((t) => t.id === a.id)?.artifacts).toBeUndefined();
  });
});

describe('show_pages buttons come from the registry', () => {
  const skills = /** @type {Record<string, any>} */ ({
    inbox: { id: 'inbox', kind: 'navigate', href: '/inbox' },
    profile: { id: 'profile', kind: 'navigate', href: 'profile', requiresUser: true }
  });
  /** @param {string | null} npub */
  const ctx = (npub) => ({
    npub,
    runCreate: vi.fn(),
    runHelp: vi.fn(),
    skillById: (/** @type {string} */ id) => skills[id],
    skillAction: (/** @type {any} */ s) => ({ label: s.id, href: s.href })
  });

  it('ids → skill buttons; unknown ids drop, a profile page needs a login', () => {
    const output = { ids: ['inbox', 'nope', 'profile'] };
    expect(TOOL_REGISTRY.show_pages.toActions?.(output, ctx('npub1x'))).toEqual([
      { label: 'inbox', href: '/inbox' },
      { label: 'profile', href: 'profile' }
    ]);
    expect(TOOL_REGISTRY.show_pages.toActions?.(output, ctx(null))).toEqual([
      { label: 'inbox', href: '/inbox' }
    ]);
  });

  it('toolActions reads every action tool part and ignores knowledge tools', () => {
    const parts = [
      { type: 'tool-search_content', output: { items: [] } },
      { type: 'dynamic-tool', toolName: 'show_pages', output: { ids: ['inbox'] } }
    ];
    expect(toolActions(parts, ctx(null))).toEqual([{ label: 'inbox', href: '/inbox' }]);
  });

  it('a restored answer’s page ids go through it', async () => {
    const spy = vi.spyOn(/** @type {any} */ (TOOL_REGISTRY.show_pages), 'toActions');
    const store = {
      list: [],
      current: null,
      refresh: async () => {},
      open: async () => ({
        id: 'c',
        title: 't',
        createdAt: 0,
        updatedAt: 0,
        turns: [
          { role: 'user', text: 'Wo ist der Kalender?', tier: 2 },
          {
            role: 'assistant',
            text: '',
            tier: 2,
            toolParts: [
              {
                type: 'dynamic-tool',
                toolName: 'show_pages',
                toolCallId: 'x',
                state: 'output-available',
                output: { ids: ['calendar', 'inbox'] }
              }
            ]
          }
        ]
      }),
      startNew: () => {},
      record: () => {},
      remove: async () => {},
      dispose: () => {}
    };
    const c2 = createConversation({
      getUser: () => null,
      loadHistoryStore: async () => ({
        createConversationStore: () => /** @type {any} */ (store),
        createRelaySync: () => ({})
      })
    });
    c2.connectHistory('anon', null);
    await c2.historyReady;
    await c2.openConversation('c');
    expect(spy).toHaveBeenCalledWith({ ids: ['calendar', 'inbox'] }, expect.anything());
    // logged out: the inbox needs a login
    expect(c2.turns.at(-1)?.actions?.map((a) => a.href)).toEqual(['/calendar']);
    spy.mockRestore();
    c2.dispose();
  });
});

describe('lesson parts: save_draft, liascript_preview, load_draft', () => {
  const MODULE = '<!-- termi:part module -->\n<!--\nauthor:\n-->\n# Modul\n\nText.';
  const LESSONS =
    '<!-- termi:part lesson 1 -->\n# Stunde 1\n\nA.\n\n<!-- termi:part lesson 2 -->\n# Stunde 2\n\nB.';
  /** @param {string} text @param {any} [extra] */
  const lessonSetup = (text, extra = {}) => {
    const { conv, ctx } = setup();
    const parts = lessonPartsOf(text);
    const id = conv.append(
      /** @type {any} */ ({ role: 'assistant', text, lessonParts: parts, ...extra })
    );
    const turn = /** @type {any} */ (conv.turns.find((t) => t.id === id));
    const lessonCtx = {
      ...ctx,
      task: /** @type {const} */ ('lesson'),
      confirm: vi.fn(async () => true),
      conversationId: () => 'conv-1',
      recordPartWrap: vi.fn(),
      replaceTurnText: conv.replaceTurnText
    };
    return { conv, ctx: lessonCtx, turn };
  };
  /** @type {{ location: { href: string }, opener: any, close: any }} */
  let tab;
  beforeEach(() => {
    Object.values(drafts).forEach((f) => f.mockReset());
    tab = { location: { href: 'about:blank' }, opener: {}, close: vi.fn() };
    vi.stubGlobal('window', { open: vi.fn(() => tab) });
  });

  it('save_draft only on lesson parts of a lesson conversation; liascript never there', () => {
    const { ctx, turn } = lessonSetup(LESSONS);
    expect(actionsFor(turn, ctx).map((a) => a.id)).toContain('save_draft');
    expect(actionsFor(turn, { ...ctx, task: 'ask' }).map((a) => a.id)).not.toContain('save_draft');
    expect(actionsFor({ ...turn, lessonParts: undefined }, ctx).map((a) => a.id)).not.toContain(
      'save_draft'
    );
    expect(actionsFor({ ...turn, pending: true }, ctx)).toEqual([]);
    // a long lesson document still gets copy/download, never the plaintext LiaScript path
    const doc = lessonSetup(MODULE + '\n\n' + 'Wort '.repeat(300));
    const ids = actionsFor(doc.turn, doc.ctx).map((a) => a.id);
    expect(ids).not.toContain('liascript');
    expect(ids).not.toContain('article');
  });

  it('save_draft saves every part, one wrap each, keeps the naddrs and records them in the state', async () => {
    drafts.saveLessonDraft
      .mockResolvedValueOnce({ naddr: 'naddr1one', dTag: 'x' })
      .mockResolvedValueOnce({ naddr: 'naddr1two', dTag: 'y' });
    const { conv, ctx, turn } = lessonSetup(LESSONS);
    await runAnswerAction(turn, action('save_draft'), ctx);
    expect(drafts.saveLessonDraft.mock.calls.map((c) => c[0].part.n)).toEqual([1, 2]);
    expect(drafts.saveLessonDraft.mock.calls[0][0].conversationId).toBe('conv-1');
    expect(conv.turns.find((t) => t.id === turn.id)?.artifacts).toEqual({
      draftWraps: { 'lesson-1': 'naddr1one', 'lesson-2': 'naddr1two' }
    });
    expect(ctx.recordPartWrap).toHaveBeenCalledWith('lesson-2', 'naddr1two', 'Stunde 2', 'conv-1');
    expect(drafts.saveLessonDraft.mock.calls[1][0].pubkey).toBe(USER.pubkey);
    expect(action('save_draft').label(ctx, conv.actionStateOf(turn.id, 'save_draft'))).toBe(
      m.termi_lesson_saved()
    );
  });

  it('save_draft: an account switch between two parts → the second save carries the old pubkey and fails; its record names the old conversation', async () => {
    const { conv, ctx, turn } = lessonSetup(LESSONS);
    let convId = 'conv-1';
    const switching = {
      ...ctx,
      conversationId: () => convId,
      get user() {
        return USER;
      }
    };
    drafts.saveLessonDraft
      .mockImplementationOnce(async () => {
        convId = 'conv-2'; // the switch restarted the window
        return { naddr: 'naddr1one', dTag: 'x' };
      })
      .mockRejectedValueOnce(new Error('account_switched'));
    await runAnswerAction(turn, action('save_draft'), switching);
    expect(drafts.saveLessonDraft.mock.calls.map((c) => c[0].pubkey)).toEqual([
      USER.pubkey,
      USER.pubkey
    ]);
    expect(ctx.recordPartWrap).toHaveBeenCalledTimes(1);
    expect(ctx.recordPartWrap).toHaveBeenCalledWith('lesson-1', 'naddr1one', 'Stunde 1', 'conv-1');
    expect(conv.actionStateOf(turn.id, 'save_draft')).toEqual({ failed: true });
  });

  it('liascript_preview uses a stable d per conversation', async () => {
    drafts.previewAsPlaintext.mockResolvedValue('naddr1plain');
    const { ctx, turn } = lessonSetup(MODULE, { artifacts: { draftWraps: { module: 'naddr1m' } } });
    await runAnswerAction(turn, action('liascript_preview'), ctx);
    expect(drafts.previewAsPlaintext.mock.calls[0][1]).toBe('lesson-conv-1-module-preview');
  });

  it('liascript_preview asks first; "no" writes nothing and opens nothing', async () => {
    const { ctx, turn } = lessonSetup(MODULE, { artifacts: { draftWraps: { module: 'naddr1m' } } });
    expect(actionsFor(turn, ctx).map((a) => a.id)).toContain('liascript_preview');
    ctx.confirm.mockResolvedValue(false);
    await runAnswerAction(turn, action('liascript_preview'), ctx);
    expect(ctx.confirm).toHaveBeenCalledWith(m.termi_lesson_preview_warning());
    expect(drafts.previewAsPlaintext).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('liascript_preview after "yes": a 30024 of the module without its marker, opened in LiaScript', async () => {
    drafts.previewAsPlaintext.mockResolvedValue('naddr1plain');
    const { conv, ctx, turn } = lessonSetup(MODULE, {
      artifacts: { draftWraps: { module: 'naddr1m' } }
    });
    await runAnswerAction(turn, action('liascript_preview'), { ...ctx, author: 'Gina' });
    const part = drafts.previewAsPlaintext.mock.calls[0][0];
    expect(part.text.startsWith('<!--\nauthor: Gina\n')).toBe(true);
    expect(part.text).not.toContain('termi:part');
    expect(tab.location.href).toBe('https://liascript.github.io/course/?nostr:naddr1plain');
    expect(conv.turns.find((t) => t.id === turn.id)?.artifacts?.draftNaddr).toBe('naddr1plain');
  });

  it('no preview before the module is saved as a wrap', () => {
    const { ctx, turn } = lessonSetup(MODULE);
    expect(actionsFor(turn, ctx).map((a) => a.id)).not.toContain('liascript_preview');
  });

  it('load_draft on a stub: every wrap decrypted → the turn text with its markers again', async () => {
    drafts.loadLessonDraft.mockImplementation(async (/** @type {string} */ n) => ({
      title: n,
      content: `# ${n}`,
      dTag: n
    }));
    const { conv, ctx, turn } = lessonSetup('<!-- termi:part lesson 1 -->\n# Stu …', {
      textStub: true,
      lessonParts: undefined,
      artifacts: { draftWraps: { 'lesson-1': 'naddr1a', module: 'naddr1b' } }
    });
    expect(actionsFor(turn, ctx).map((a) => a.id)).toEqual(['load_draft']);
    await runAnswerAction(turn, action('load_draft'), ctx);
    const after = conv.turns.find((t) => t.id === turn.id);
    expect(after?.text).toBe(
      '<!-- termi:part lesson 1 -->\n# naddr1a\n\n<!-- termi:part module -->\n# naddr1b'
    );
    expect(after?.textStub).toBeUndefined();
  });

  it('load_draft: one unreadable wrap → failed, the stub text is kept', async () => {
    drafts.loadLessonDraft.mockResolvedValue(null);
    const stub = '<!-- termi:part lesson 1 -->\n# Stu …';
    const { conv, ctx, turn } = lessonSetup(stub, {
      textStub: true,
      artifacts: { draftWraps: { 'lesson-1': 'naddr1a' } }
    });
    await runAnswerAction(turn, action('load_draft'), ctx);
    expect(conv.actionStateOf(turn.id, 'load_draft')).toEqual({ failed: true });
    expect(conv.turns.find((t) => t.id === turn.id)?.text).toBe(stub);
  });
});

describe('publish_series', () => {
  /** @param {any} [over] */
  const phaseSetup = (over = {}) => {
    const { conv, ctx } = setup();
    const turn = answer(conv, 'Alles fertig – bereit zum Veröffentlichen?');
    const pubCtx = {
      ...ctx,
      task: /** @type {const} */ ('lesson'),
      lessonState: /** @type {any} */ ({ phase: 7 }),
      isLatest: (/** @type {string} */ id) => id === turn.id,
      openLessonPublish: vi.fn(),
      ...over
    };
    return { turn, ctx: pubCtx };
  };
  const ids = (/** @type {any} */ turn, /** @type {any} */ ctx) =>
    actionsFor(turn, ctx).map((a) => a.id);

  it('only on the latest assistant turn of a lesson in phase 7, signed in', () => {
    const { turn, ctx } = phaseSetup();
    expect(ids(turn, ctx)).toContain('publish_series');
    expect(ids(turn, { ...ctx, lessonState: { phase: 6 } })).not.toContain('publish_series');
    expect(ids(turn, { ...ctx, lessonState: null })).not.toContain('publish_series');
    expect(ids(turn, { ...ctx, task: 'ask' })).not.toContain('publish_series');
    expect(ids(turn, { ...ctx, isLatest: () => false })).not.toContain('publish_series');
    expect(ids(turn, { ...ctx, user: null })).not.toContain('publish_series');
    expect(ids({ ...turn, pending: true }, ctx)).not.toContain('publish_series');
    expect(ids({ ...turn, role: 'user' }, ctx)).not.toContain('publish_series');
  });

  it('also on a latest turn with a sources part when no phase-7 patch came', () => {
    const { turn, ctx } = phaseSetup({ lessonState: { phase: 6 } });
    const sources = { ...turn, lessonParts: [{ kind: 'sources', title: 'Quellen', text: '- A' }] };
    expect(ids(sources, ctx)).toContain('publish_series');
    expect(ids(sources, { ...ctx, lessonState: null })).toContain('publish_series');
    const lesson = { ...turn, lessonParts: [{ kind: 'lesson', n: 1, title: 'S', text: 'x' }] };
    expect(ids(lesson, ctx)).not.toContain('publish_series');
  });

  it('opens the publish modal through the window', async () => {
    const { turn, ctx } = phaseSetup();
    await runAnswerAction(turn, action('publish_series'), ctx);
    expect(ctx.openLessonPublish).toHaveBeenCalledOnce();
  });
});
