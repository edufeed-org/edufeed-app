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

const { ANSWER_ACTIONS, actionsFor, runAnswerAction } = await import('../answer-actions.js');
const { createConversation } = await import('../termi-conversation.svelte.js');
const { TOOL_REGISTRY, toolActions } = await import('$lib/termi/tool-registry.js');

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
