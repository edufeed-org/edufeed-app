// Termi's conversation, without the window: canned and router replies, the
// tier-1 content path, the tier-2 `ask` chat (start, talk, 503 → fallback,
// 403 → ineligible, 429/upstream → rescue), the account-switch reset and the
// history save/restore. Moved out of TermiChatWindow unchanged; the window
// keeps the view state (input, drag, history list open) and the templates.
//
// One ordered `turns` list (codec `Turn`): the window's own turns (router,
// tier 1, restored, imports) live in `local`; the running AI-SDK Chat stays the
// source of truth for tier 2 and is projected in, each local turn at the time
// it was added. Functions and Files sit in `side`, keyed by turn id. Effects
// stay in the window; it calls `syncAccount`, `observeChatStatus` and
// `connectHistory` from them.
import * as m from '$lib/paraglide/messages';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { helpLinkAttrs } from '$lib/helpers/help-link.js';
import { matchSuggestion } from '$lib/helpers/assistant-hints.js';
import { hasNip44 } from '$lib/helpers/nip44.js';
import {
  firstQuery,
  fromTier1Message,
  fromUIMessage,
  textOf,
  toTier1Message,
  toUIMessage
} from './history/conversation-codec.js';
import {
  TOOL_REGISTRY,
  isKnowledgeTool,
  itemsOf,
  toolActions,
  toolNameOf,
  toolOptions
} from '$lib/termi/tool-registry.js';
import { unique } from '$lib/helpers/unique.js';
import {
  addMaterialTo,
  lessonPartsOf,
  withPartWrap,
  withPublished,
  mergeLessonState,
  sanitizeLessonPatch,
  sanitizeLessonState
} from '$lib/termi/lesson-state.js';
import { keepItem } from './cards/filter.js';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { nip19 } from 'nostr-tools';
import { getLocale as paraglideLocale } from '$lib/paraglide/runtime';
import { TERMI_SKILLS, extractQuery } from '$lib/helpers/termi-skills.js';
import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
import { runCreateAction } from '$lib/helpers/run-create-action.js';
import { canSign } from '$lib/helpers/signing-guard.js';
import {
  routeQuestion,
  detectTask,
  skillAction,
  skillById,
  helpAnswer,
  searchContent,
  discoverHref,
  isTermiEligible,
  markTermiIneligible
} from './termi-router.js';

/** @typedef {import('./termi-router.js').TermiAction} TermiAction */
/** @typedef {import('./import/publish-imported.js').ImportState} ImportState */
/** @typedef {import('./history/conversation-codec.js').Turn} Turn */
/** @typedef {import('$lib/helpers/termi-skills.js').TermiSkill} TermiSkill */
/** @typedef {import('$lib/termi/items.d.js').Item} Item */
/** @typedef {{ q: string, a: string, link?: { label: string, attrs: NonNullable<ReturnType<typeof helpLinkAttrs>> } }} Suggestion */
/** @typedef {Omit<Turn, 'id' | 'tier'> & { tier?: 1 | 2 }} NewTurn */
/**
 * Per turn, never in it: `retry` (tier-1 cards), `file` (an import's source),
 * `importOf` (the import's question: recorded with its summary only) and `at`
 * (the chat's length when the turn was added: its place among the chat turns);
 * `stored` (a restored turn's record form: re-saved as it was, tier 2 and tool parts kept).
 * @typedef {{ retry?: () => void, file?: File, importOf?: boolean, at?: number, stored?: Turn }} Side
 */
/** @typedef {{ chat: import('@ai-sdk/svelte').Chat, reset: () => void }} TermiAssistantChat */
/** @typedef {ReturnType<typeof import('./history/conversation-store.svelte.js').createConversationStore>} ConversationStore */
/** @typedef {{ createConversationStore: (opts: any) => ConversationStore, createRelaySync: (opts: any) => any }} HistoryModule */

// Knowledge tools' outputs are `{ items, sourcesUnavailable }` (the tool registry).
/** @param {any} p */
const isKnowledgePart = (p) => isKnowledgeTool(toolNameOf(p));
/** A record younger than this reopens by itself when the window comes up empty (reload, reopen). */
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
/** @param {any} msg */
const searchPartsOf = (msg) =>
  msg.parts.filter((/** @type {any} */ p) => isKnowledgePart(p) && p.state === 'output-available');
// All knowledge tool outputs of one answer as ONE card list: the model often calls
// several tools for one question; ItemCards dedupes the items by type:id.
/** @param {any} msg */
const searchOf = (msg) => {
  const parts = searchPartsOf(msg);
  return {
    items: /** @type {Item[]} */ (
      parts.flatMap((/** @type {any} */ p) => itemsOf(toolNameOf(p), p.output))
    ),
    sourcesUnavailable: /** @type {string[]} */ (
      unique(parts.flatMap((/** @type {any} */ p) => p.output?.sourcesUnavailable ?? []))
    ),
    query: firstQuery(parts)
  };
};
// Action tools (show_pages) never count toward emptyAnswer/searchFailed.
/** @param {any} msg */
const finishedPartsOf = (msg) =>
  msg.parts.filter((/** @type {any} */ p) => p.state === 'output-available');

/**
 * @param {{
 *   getUser: () => any,
 *   getLocale?: () => string,
 *   fetch?: typeof fetch,
 *   loadHistoryStore?: () => Promise<HistoryModule>,
 *   chatFactory?: (opts: { task: 'ask'|'lesson', user: any, getBodyExtras: () => Record<string, unknown> }) => Promise<TermiAssistantChat>,
 *   onRestart?: () => void
 * }} deps onRestart: the window drops its own per-conversation view state (the attachment chip)
 */
export function createConversation({
  getUser,
  getLocale = paraglideLocale,
  fetch = (...a) => globalThis.fetch(...a),
  loadHistoryStore = () => import('./history/conversation-store.svelte.js'),
  chatFactory = async (opts) => (await import('./termi-chat.svelte.js')).createTermiChat(opts),
  onRestart = () => {}
}) {
  const localeOf = () => (getLocale() === 'en' ? 'en' : 'de');

  // The user guide (HELP_URL). Only offer the getting-started chip when a
  // deployment has one.
  const helpLink = () => helpLinkAttrs(runtimeConfig.help?.url);

  /** @returns {Suggestion[]} */
  const suggestions = () => {
    const link = helpLink();
    return [
      ...(link
        ? [
            {
              q: m.termi_sugg_4_q(),
              a: m.termi_sugg_4_a(),
              link: { label: m.termi_sugg_4_link(), attrs: link }
            }
          ]
        : []),
      { q: m.termi_sugg_1_q(), a: m.termi_sugg_1_a() },
      { q: m.termi_sugg_2_q(), a: m.termi_sugg_2_a() },
      { q: m.termi_sugg_3_q(), a: m.termi_sugg_3_a() }
    ];
  };

  // The window's own turns, in order; chat turns are projected in by `interleave`.
  /** @type {Turn[]} */
  let local = $state.raw([]);
  // Bookkeeping beside `local`: written together with it, so `local` carries the reactivity.
  /** @type {Map<string, Side>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const side = new Map();
  let turnSeq = 0;
  const newId = () => `turn-${++turnSeq}`;
  /**
   * Adds a window turn at the end of the conversation (after the chat's latest message).
   * @param {NewTurn} turn @param {Side} [extra] @returns {string} its id
   */
  function append(turn, extra = {}) {
    const id = newId();
    side.set(id, { ...extra, at: assistant?.chat.messages.length });
    local = [...local, /** @type {Turn} */ ({ tier: 1, ...turn, id })];
    return id;
  }
  let botTyping = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let replyTimer;
  // Plain let: an assistant start still waiting on its chunk must not sign or send after close.
  let destroyed = false;

  // Assistant mode: an AI chat (/api/termi/chat), started by a content
  // question when the account may use it. Memory only.
  let assistant = $state.raw(/** @type {TermiAssistantChat | null} */ (null));
  // The conversation's server task: fixed when its first message starts the chat, never re-routed.
  let task = $state(/** @type {import('./history/conversation-codec.js').TermiTask} */ ('ask'));
  // Set once a chat started or a record was opened; cleared by restart().
  let taskFixed = false;
  // The lesson task's phase state and her files: conversation-level, sent with every request.
  let lessonState = $state.raw(
    /** @type {import('$lib/termi/lesson-state.js').LessonState | null} */ (null)
  );
  let materials = $state.raw(
    /** @type {import('$lib/termi/lesson-state.js').LessonMaterial[]} */ ([])
  );
  // lesson_state calls already folded into `lessonState` (by toolCallId); bookkeeping, never rendered
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let folded = new Set();
  // A stored lesson record opened without a chat: the next ask() starts its lesson chat, seeded.
  /** @type {{ conv: import('./history/conversation-codec.js').Conversation, pubkey: string | undefined } | null} */
  let resume = null;
  // Getters, not $derived: they read the Chat's own state, so a fake chat in a test works too.
  const chatBusy = () =>
    !!assistant && (assistant.chat.status === 'submitted' || assistant.chat.status === 'streaming');
  const chatError = () =>
    /** @type {(Error & { status?: number, scope?: string }) | undefined} */ (
      assistant?.chat.error
    );

  /** @param {any} msg @returns {TermiAction[]} */
  const pageActionsOf = (msg) => toolActions(finishedPartsOf(msg), skillCtx(getUser()?.pubkey));
  /** @param {any} msg */
  const lastStreaming = (msg) => chatBusy() && assistant?.chat.messages.at(-1)?.id === msg.id;
  // A failed search with no model text to explain it gets a note of its own.
  /** @param {any} msg */
  const searchFailed = (msg) =>
    msg.role === 'assistant' &&
    !textOf(msg) &&
    msg.parts.some((/** @type {any} */ p) => isKnowledgePart(p) && p.state === 'output-error') &&
    !lastStreaming(msg);
  // Neither text nor a card nor a failed search: the fallback line with the router's guesses.
  /** @param {any} msg @param {TermiAction[]} [pages] its page actions, when the caller has them */
  const emptyAnswer = (msg, pages = pageActionsOf(msg)) =>
    msg.role === 'assistant' &&
    !textOf(msg) &&
    !searchFailed(msg) &&
    !searchPartsOf(msg).some((/** @type {any} */ p) =>
      itemsOf(toolNameOf(p), p.output).some(keepItem)
    ) &&
    pages.length === 0 &&
    !toolOptions(finishedPartsOf(msg)) &&
    !lastStreaming(msg) &&
    !chatError();
  /** @param {any} msg @param {TermiAction[]} [pages] its page actions, when the caller has them */
  const visible = (msg, pages = pageActionsOf(msg)) =>
    msg.role === 'user' ||
    !!textOf(msg) ||
    searchPartsOf(msg).length > 0 ||
    searchFailed(msg) ||
    pages.length > 0 ||
    !!toolOptions(finishedPartsOf(msg)) ||
    emptyAnswer(msg, pages);
  // The router's guesses belong to the answer to the routed question; follow-ups were never routed.
  const firstAssistantId = () => assistant?.chat.messages.find((x) => x.role === 'assistant')?.id;
  /** @param {any} msg @param {boolean} [beside] next to a real answer: the strict list */
  const guessesFor = (msg, beside = false) =>
    msg.id === firstAssistantId() ? (beside ? strongGuessSkills : guessSkills) : [];
  // Only the latest answer can be regenerated.
  const lastAssistantId = () =>
    assistant?.chat.messages.findLast((x) => x.role === 'assistant')?.id;
  const chatSentence = () => {
    const lastUser = assistant?.chat.messages.findLast((x) => x.role === 'user');
    return lastUser ? textOf(lastUser) : '';
  };
  const chatQuery = () => {
    const sentence = chatSentence();
    return sentence ? extractQuery(sentence, localeOf()) : '';
  };
  const learningHref = (/** @type {string} */ q) => discoverHref('learning', q);

  /**
   * Takes a typed question (or a chip). False when it was not taken: empty,
   * still answering, or the chat is busy — the window then keeps the text.
   * @param {string} q
   */
  function ask(q) {
    if (!q.trim() || botTyping) return false;
    if (assistant) {
      if (chatBusy()) return false;
      talk((chat) => chat.sendMessage({ text: q.trim() }));
      return true;
    }
    const match = matchSuggestion(q, suggestions());
    append({ role: 'user', text: q.trim() });
    botTyping = true;
    if (resume) {
      // the record as saved now: exchanges made since the open (a refused start) are kept
      const current = history?.current;
      startAssistant(
        q.trim(),
        getUser(),
        'lesson',
        current?.id === resume.conv.id ? current : resume.conv
      );
      return true;
    }
    if (!match && runtimeConfig.termi?.enabled) {
      routeAnswer(q.trim());
      return true;
    }
    replyTimer = setTimeout(() => {
      botTyping = false;
      append(
        match
          ? { role: 'assistant', text: match.a, link: match.link }
          : { role: 'assistant', text: m.termi_fallback() }
      );
    }, 900);
    return true;
  }

  /**
   * The assistant signs every request (no readonly account) and is gated by
   * NIP-05 domain on the server; the probe predicts that answer.
   * @param {any} user
   */
  const canUseAssistant = (user) => !!runtimeConfig.termi?.llm && canSign(user);
  /** @param {any} user */
  const assistantAllowed = async (user) =>
    canUseAssistant(user) && (await isTermiEligible(user.pubkey, fetch));

  /**
   * Tier 2 refused (gate, off): back to router mode with its line and one
   * tier-1 search for the same sentence — cards, or the plain learning search.
   * @param {string} line @param {string} sentence
   */
  async function fallBackToContent(line, sentence) {
    // the chat's earlier exchanges stay, read-only, in their place (and in the record)
    if (assistant) {
      const ctx = skillCtx(getUser()?.pubkey);
      local = interleave((msg) => (visible(msg) ? readOnlyTurn(fromUIMessage(msg), ctx) : null));
    }
    leaveAssistant();
    botTyping = true;
    const pubkey = getUser()?.pubkey;
    const locale = localeOf();
    const result = await searchContent(sentence, { locale, fetch });
    if (destroyed) return;
    botTyping = false;
    // Switched meanwhile: the answer belonged to the other account.
    if (pubkey !== getUser()?.pubkey) return;
    const reply = contentReply(result, sentence);
    // Nothing kept: the line plus the learning search; the sources note and retry stay.
    const search = {
      label: m.termi_quota_link(),
      href: learningHref(extractQuery(sentence, locale))
    };
    append(
      { ...reply, text: line, ...(reply.items ? {} : { actions: [search] }) },
      { retry: () => contentSearch(sentence) }
    );
    saveHistory();
  }

  // Tier 1 under a quota / stream-error line (the chat stays); once per sentence.
  /** @type {{ sentence: string, items: Array<Item>, sourcesUnavailable: string[] } | null} */
  let rescue = $state.raw(null);

  /** The router's weak navigate/create/help matches for the routed sentence ("Meinst du …?"). */
  let guessSkills = $state.raw(/** @type {TermiSkill[]} */ ([]));
  /** The subset safe to show beside real results (keyword mode: full phrase matches only). */
  let strongGuessSkills = $state.raw(/** @type {TermiSkill[]} */ ([]));

  // Pubkey the current assistant chat signs as; read by syncAccount.
  /** @type {string | undefined} */
  let assistantPubkey;

  /**
   * @param {string} text the user's question, already shown as the router bubble
   * @param {any} user the account it was routed as (a switch meanwhile drops the start)
   * @param {import('./history/conversation-codec.js').TermiTask} [chatTask]
   * @param {import('./history/conversation-codec.js').Conversation} [seed] a resumed record: its turns go into the chat first
   */
  async function startAssistant(text, user, chatTask = 'ask', seed) {
    // Answered from the probe cache: routeAnswer already asked for this user.
    const allowed = await assistantAllowed(user);
    if (destroyed) return;
    // Switched meanwhile: the question belonged to the other account, drop it quietly.
    if (user?.pubkey !== getUser()?.pubkey) {
      botTyping = false;
      return;
    }
    if (!allowed) {
      fallBackToContent(
        canUseAssistant(user) ? m.termi_assistant_not_eligible() : m.termi_assistant_unavailable(),
        text
      );
      return;
    }
    const created = await chatFactory({ task: chatTask, user, getBodyExtras });
    if (destroyed) return;
    if (user?.pubkey !== getUser()?.pubkey) {
      botTyping = false;
      return;
    }
    task = chatTask;
    taskFixed = true;
    assistantPubkey = user.pubkey;
    assistant = created;
    resume = null;
    botTyping = false;
    // the model sees the earlier turns; the question then follows as a chat message
    // (seedChat replaces the window turns, so its bubble is not doubled)
    if (seed) seedChat(seed);
    await talk((chat) => chat.sendMessage({ text }));
  }

  /** An account switch ends the chat: it was signed, and gated, as the old account. @param {string | undefined} pubkey */
  function syncAccount(pubkey) {
    if ((assistant && pubkey !== assistantPubkey) || (resume && pubkey !== resume.pubkey))
      restart();
  }

  /** @param {(chat: import('@ai-sdk/svelte').Chat) => Promise<void>} run */
  async function talk(run) {
    const current = assistant;
    if (!current) return;
    await run(current.chat);
    if (current !== assistant) return;
    const sentence = chatSentence();
    const error = chatError();
    // 503: LLM/nope-mcp off or eligibility_unknown — back to the router, tier 1 instead.
    if (error?.status === 503) fallBackToContent(m.termi_assistant_unavailable(), sentence);
    // 403: the NIP-05 gate refused this account (the probe was stale).
    else if (error?.status === 403) {
      if (assistantPubkey) markTermiIneligible(assistantPubkey);
      fallBackToContent(m.termi_assistant_not_eligible(), sentence);
    } else if (
      // 429 with no scope is `busy` (a request still in flight for this
      // pubkey) — nothing to rescue, it's not a content gap.
      ((error?.status === 429 && error?.scope) || error?.message === 'termi:upstream') &&
      rescue?.sentence !== sentence
    ) {
      botTyping = true;
      const result = await searchContent(sentence, { locale: localeOf(), fetch });
      if (destroyed) return;
      botTyping = false;
      if (current !== assistant) return; // restarted / switched meanwhile
      rescue = { sentence, ...result };
    }
  }

  function leaveAssistant() {
    assistant?.reset();
    assistant = null;
    // the chat's turns are gone: the rest simply keeps its order
    for (const s of side.values()) delete s.at;
  }

  function restart() {
    leaveAssistant();
    local = [];
    task = 'ask';
    taskFixed = false;
    lessonState = null;
    materials = [];
    folded = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity
    resume = null;
    localConversationId = undefined;
    side.clear();
    actionState = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced, never mutated
    onRestart();
  }

  // Conversation history (flag on): one store per account, recreated on a
  // switch; anonymous history lives in sessionStorage only.
  let history = $state.raw(/** @type {ConversationStore | null} */ (null));
  /** @type {string | undefined} */
  let lastHistoryScope;
  /** Settles once the latest connectHistory has its store (or was cancelled). */
  let historyReady = Promise.resolve();

  /**
   * Opens the account's history store (lazily: the store pulls the publish
   * stack in). A scope change first ends the old account's conversation.
   * @param {string} scope pubkey or 'anon' @param {any} user
   * @returns {() => void} closes the store
   */
  function connectHistory(scope, user) {
    // The conversation belongs to the old account: never record it into the new one.
    if (lastHistoryScope !== undefined && lastHistoryScope !== scope) restart();
    lastHistoryScope = scope;
    let cancelled = false;
    /** @type {ConversationStore | null} */
    let store = null;
    historyReady = loadHistoryStore().then(({ createConversationStore, createRelaySync }) => {
      if (cancelled) return;
      const signer = user?.signer;
      store = createConversationStore({
        scope,
        sync: user && hasNip44(signer) ? createRelaySync({ signer, pubkey: scope }) : null
      });
      history = store;
      // A reload or a reopened window continues the conversation that was
      // running: the newest record of the last hours opens by itself while
      // the window is still empty (a reload mid-planning lost 8 turns of
      // context on 2026-11-11). "Neue Unterhaltung" is one click away.
      const last = store.list[0];
      if (last && Date.now() - last.updatedAt < RESUME_WINDOW_MS && !local.length && !assistant) {
        void openConversation(last.id);
      }
    });
    return () => {
      cancelled = true;
      store?.dispose();
      history = null;
    };
  }

  /** The user bubble of an import. @param {ImportState} s */
  const importPrompt = (s) => s.instruction || m.termi_import_default_prompt({ file: s.source });

  /**
   * The window's turns with the chat's messages in between, each window turn
   * after the chat messages that existed when it was added.
   * @param {(msg: any) => Turn | null} project a chat message as a turn, or null to skip it
   * @param {() => Turn | null} [tail] right after the last chat message (the chat's error line)
   * @returns {Turn[]}
   */
  function interleave(project, tail = () => null) {
    const chat = assistant?.chat.messages ?? [];
    /** @type {Turn[]} */
    const out = [];
    let li = 0;
    /** @param {number} upTo */
    const flush = (upTo) => {
      while (li < local.length && (side.get(local[li].id ?? '')?.at ?? 0) <= upTo)
        out.push(local[li++]);
    };
    // Message 0 is the routed question, already a window turn: the one place it is skipped.
    for (let i = 1; i < chat.length; i++) {
      flush(i);
      const t = project(chat[i]);
      if (t) out.push(t);
    }
    // only a one-message chat needs it (the loop never ran): its question goes before the error line
    flush(chat.length - 1);
    const last = tail();
    if (last) out.push(last);
    flush(Infinity);
    return out;
  }

  /** A chat message as the window shows it; null while there is nothing to show. @param {any} msg @returns {Turn | null} */
  function chatTurn(msg) {
    // once per message: it runs on every streamed token
    const pages = msg.role === 'user' ? [] : pageActionsOf(msg);
    if (!visible(msg, pages)) return null;
    /** @type {Turn} */
    const turn = { ...fromUIMessage(msg), id: msg.id };
    if (turn.role === 'user') return turn;
    const pending = lastStreaming(msg);
    if (pending) turn.pending = true;
    if (pages.length) turn.actions = pages;
    const options = toolOptions(turn.toolParts ?? []);
    if (options) turn.options = options;
    // a stub's text is cut: its parts are only in their wraps, never re-saved from it
    if (task === 'lesson' && !turn.textStub) {
      const parts = lessonPartsOf(turn.text);
      if (parts.length) {
        turn.lessonParts = parts;
        turn.lessonPart = parts[0];
      }
    }
    const empty = emptyAnswer(msg, pages);
    if (!turn.text && searchFailed(msg)) {
      turn.text = m.termi_search_failed();
      turn.actions = [{ label: m.termi_quota_link(), href: learningHref(chatQuery()) }, ...pages];
    } else if (empty) {
      const reply = fallbackReply(guessesFor(msg));
      turn.text = reply.text;
      turn.actions = reply.actions;
    }
    // Beside any non-empty answer (a failed search too): the routed question's strict guesses.
    if (!empty && !pending && pages.length === 0) {
      const guessed = guessActions(guessesFor(msg, true));
      if (guessed.length) turn.guesses = guessed;
    }
    if (searchPartsOf(msg).length > 0) {
      const search = searchOf(msg);
      turn.items = search.items;
      turn.sourcesUnavailable = search.sourcesUnavailable;
      turn.query = search.query;
    }
    return turn;
  }

  /** The chat's error line (quota, busy, upstream), with the rescue's cards. @returns {Turn | null} */
  function errorTurn() {
    const error = chatError();
    if (!error || chatBusy()) return null;
    /** @type {Turn} */
    const turn = {
      id: 'termi-chat-error',
      role: 'assistant',
      tier: 2,
      text: '',
      error: { status: error.status, scope: error.scope, href: learningHref(chatQuery()) }
    };
    if (rescue && rescue.sentence === chatSentence() && rescue.items.some(keepItem)) {
      turn.items = rescue.items;
      turn.sourcesUnavailable = rescue.sourcesUnavailable;
      turn.query = chatQuery();
    }
    return turn;
  }

  /** Only the latest live chat answer's option card takes a click, and not while the chat runs. @param {Turn} turn */
  const canPick = (turn) =>
    !!turn.options && !chatBusy() && turn.id === assistant?.chat.messages.at(-1)?.id;

  /** Retry for a turn's cards: tier 1 asks again; tier 2 regenerates the latest answer. @param {Turn} turn */
  function retryOf(turn) {
    const own = side.get(turn.id ?? '')?.retry;
    if (own) return own;
    if (turn.tier === 2 && !turn.error && turn.id === lastAssistantId())
      return () => talk((chat) => chat.regenerate());
    return undefined;
  }

  /** The conversation as stored turns (an import only once published, as its summary). @returns {Turn[]} */
  function turnsNow() {
    return interleave(fromUIMessage).flatMap((t) => {
      if (t.tier === 2) return [t];
      const kept = side.get(t.id ?? '')?.stored;
      if (kept) return [t.artifacts ? { ...kept, artifacts: t.artifacts } : kept];
      // the import's question is recorded with its summary, only once published
      if (side.get(t.id ?? '')?.importOf) return [];
      if (t.import) {
        if (t.import.status !== 'done') return [];
        const n = t.import.result?.ok.length ?? 0;
        const text = m.termi_history_import_summary({ n, file: t.import.source });
        return [
          { role: 'user', text: importPrompt(t.import), tier: 1 },
          { role: 'assistant', text, tier: 1 }
        ];
      }
      return t.text || t.items ? [fromTier1Message(t)] : [];
    });
  }

  /**
   * Keeps an action's result on its answer (the LiaScript draft) and records it.
   * A chat answer keeps it in its chat message's metadata, the source of its turn.
   * @param {string} id @param {import('./history/conversation-codec.js').Artifacts} patch
   */
  function setArtifacts(id, patch) {
    const chat = assistant?.chat;
    if (chat?.messages.some((x) => x.id === id)) {
      chat.messages = chat.messages.map((x) => {
        if (x.id !== id) return x;
        const meta = /** @type {any} */ (x).metadata;
        return /** @type {any} */ ({
          ...x,
          metadata: { ...meta, artifacts: { ...meta?.artifacts, ...patch } }
        });
      });
    } else {
      local = local.map((t) =>
        t.id === id ? { ...t, artifacts: { ...t.artifacts, ...patch } } : t
      );
    }
    saveHistory();
  }

  /**
   * A stub answer's text, loaded back from its wraps: the turn is whole again.
   * @param {string} id @param {string} text
   */
  function replaceTurnText(id, text) {
    const chat = assistant?.chat;
    if (chat?.messages.some((x) => x.id === id)) {
      chat.messages = chat.messages.map((x) => {
        if (x.id !== id) return x;
        const { textStub: _stub, ...meta } = /** @type {any} */ (x).metadata ?? {};
        return /** @type {any} */ ({
          ...x,
          parts: [...x.parts.filter((p) => p.type !== 'text'), { type: 'text', text }],
          metadata: meta
        });
      });
    } else {
      local = local.map((t) => (t.id === id ? { ...t, text, textStub: undefined } : t));
    }
  }

  /**
   * A part's wrap, recorded in the lesson state (`parts.lessons[n].wrap` / `parts.<kind>.wrap`).
   * @param {string} key `lesson-<n>` or a part kind @param {string} naddr @param {string} [title]
   * @param {string} [convId] the conversation the save started in: a save outliving it records nothing
   */
  function recordPartWrap(key, naddr, title, convId) {
    if (convId !== undefined && convId !== conversationId()) return;
    foldLessonState();
    const next = withPartWrap(lessonState, key, naddr, title);
    if (sanitizeLessonState(next)) lessonState = next;
    else console.warn('[termi] lesson state over 16 KB, wrap not recorded');
    saveHistory();
  }

  /**
   * Phase 7's publishes (a part's 30023, the 30040, the 30142), recorded through the
   * state path — a model patch can never write them.
   * @param {import('$lib/termi/lesson-state.js').PublishedRecord} rec
   * @param {string} [convId] the conversation the run started in: a run outliving it records nothing
   */
  function recordPublished(rec, convId) {
    if (convId !== undefined && convId !== conversationId()) return;
    foldLessonState();
    const next = withPublished(lessonState, rec);
    if (sanitizeLessonState(next)) lessonState = next;
    else console.warn('[termi] lesson state over 16 KB, publish not recorded');
    saveHistory();
  }

  // Without a history store (no account scope yet) a save still needs a stable id.
  /** @type {string | undefined} */
  let localConversationId;
  const conversationId = () =>
    history?.current?.id ?? (localConversationId ??= crypto.randomUUID());

  // Answer-action UI state (copied, busy, failed): turn id → action id → state. Replaced on write.
  /** @typedef {import('./answer-actions.js').ActionState} ActionState */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let actionState = $state.raw(/** @type {Map<string, Map<string, ActionState>>} */ (new Map()));
  /** @param {string} turnId @param {string} actionId */
  const actionStateOf = (turnId, actionId) => actionState.get(turnId)?.get(actionId);
  /** @param {string} turnId @param {string} actionId @param {ActionState | undefined} state */
  function setActionState(turnId, actionId, state) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Map(actionState);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const per = new Map(next.get(turnId));
    if (state) per.set(actionId, state);
    else per.delete(actionId);
    next.set(turnId, per);
    actionState = next;
  }

  function saveHistory() {
    const turns = turnsNow();
    if (!history || !turns.some((t) => t.role === 'assistant')) return;
    foldLessonState();
    history.record(turns, {
      // a part saved before the first record keeps its conversation id
      ...(!history.current && localConversationId ? { id: localConversationId } : {}),
      task,
      lesson: lessonState ?? undefined,
      materials: materials.length ? materials : undefined
    });
  }

  /** Every finished lesson_state call not yet folded, in message order (lesson task only). */
  function foldLessonState() {
    if (task !== 'lesson' || !assistant) return;
    let next = lessonState;
    for (const msg of assistant.chat.messages) {
      for (const p of /** @type {any[]} */ (msg.parts ?? [])) {
        if (toolNameOf(p) !== 'lesson_state' || p.state !== 'output-available') continue;
        if (folded.has(p.toolCallId)) continue;
        folded.add(p.toolCallId);
        if (p.output?.rejected) continue;
        const patch = sanitizeLessonPatch(p.output);
        if (!patch) continue;
        const merged = mergeLessonState(next, patch);
        // never grow past what the server and a reload accept
        if (sanitizeLessonState(merged)) next = merged;
        else console.warn('[termi] lesson state over 16 KB, patch dropped');
      }
    }
    if (next !== lessonState) lessonState = next;
  }

  /** The lesson task's extra request fields, read per request. */
  function getBodyExtras() {
    if (task !== 'lesson') return {};
    foldLessonState();
    return {
      lesson: lessonState ?? undefined,
      materials: materials.length ? materials : undefined,
      locale: localeOf()
    };
  }

  /** One of her files for the series (3 files, 15 000 chars; same name replaces). @param {{ name: string, text: string }} file */
  function addMaterial(file) {
    materials = addMaterialTo(materials, file);
  }

  // A finished tier-2 answer (streaming → ready) is recorded; a restore does not pass through streaming.
  /** @type {string | undefined} */
  let lastChatStatus;
  /** @param {string | undefined} status the chat's status, from the window's effect */
  function observeChatStatus(status) {
    foldLessonState();
    if (status === 'ready' && lastChatStatus && lastChatStatus !== 'ready') saveHistory();
    lastChatStatus = status;
  }

  /**
   * A stored turn as a read-only window turn (new id); show_pages ids become page actions.
   * @param {Turn} stored @param {import('$lib/termi/tool-registry.js').ToolActionCtx} ctx @returns {Turn}
   */
  function readOnlyTurn(stored, ctx) {
    const { pageIds = [], ...turn } = toTier1Message(stored, newId());
    // the codec flattens stored show_pages outputs into `pageIds` (audit B13), so no tool parts to pass
    const actions = TOOL_REGISTRY.show_pages.toActions?.({ ids: pageIds }, ctx) ?? [];
    return actions.length ? { ...turn, actions } : turn;
  }

  /** Stored turns as read-only window turns. @param {Turn[]} list */
  function restore(list) {
    side.clear();
    actionState = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced, never mutated
    const ctx = skillCtx(getUser()?.pubkey);
    local = list.map((stored) => {
      const turn = readOnlyTurn(stored, ctx);
      side.set(/** @type {string} */ (turn.id), { stored });
      return turn;
    });
  }

  /**
   * Tier-2 turns continue in the chat only when it runs for this account; the
   * first question becomes a window turn (`interleave` skips message 0). Otherwise
   * everything is read-only and a follow-up starts a fresh context.
   * @param {string} id
   * @returns {Promise<boolean>} false when nothing was opened
   */
  async function openConversation(id) {
    if (!history) return false;
    const store = history;
    const pk = getUser()?.pubkey;
    /** @type {import('./history/conversation-codec.js').Conversation} */
    let conv;
    try {
      conv = await store.open(id);
    } catch (err) {
      console.warn('[termi] conversation open failed:', err);
      return false;
    }
    // closed or switched meanwhile: the record belongs to the old account
    if (destroyed || history !== store || getUser()?.pubkey !== pk) return false;
    rescue = null;
    guessSkills = [];
    strongGuessSkills = [];
    resume = null;
    const convTask = conv.task ?? 'ask';
    // the stored state already holds every stored lesson_state call
    lessonState = conv.lesson ?? null;
    materials = conv.materials ?? [];
    folded = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity
    // The running chat was made for one task: a record of the other one opens read-only.
    if (assistant && convTask === task && chatStart(conv) >= 0) {
      // reset() must not look like a finished answer: no re-save of the old window
      lastChatStatus = 'ready';
      assistant.reset();
      seedChat(conv);
      return true;
    }
    leaveAssistant();
    restore(conv.turns);
    // a follow-up starts a fresh chat of the record's task; a lesson one resumes, seeded
    task = convTask;
    taskFixed = true;
    if (convTask === 'lesson') resume = { conv, pubkey: pk };
    return true;
  }

  /**
   * Where a record's chat starts: the router question (a user turn) before its
   * first tier-2 turn; -1 when it has none.
   * @param {import('./history/conversation-codec.js').Conversation} conv
   */
  function chatStart(conv) {
    const t2 = conv.turns.findIndex((t) => t.tier === 2);
    const start = t2 > 0 && conv.turns[t2 - 1].role === 'user' ? t2 - 1 : t2;
    return start >= 0 && conv.turns[start].role === 'user' ? start : -1;
  }

  /**
   * Tier-2 turns of a record continue in the running chat; the first question
   * becomes a window turn (`interleave` skips message 0). Nothing when it has none.
   * @param {import('./history/conversation-codec.js').Conversation} conv
   */
  function seedChat(conv) {
    const start = chatStart(conv);
    if (!assistant || start < 0) return;
    restore(conv.turns.slice(0, start + 1));
    // Only tier-2 turns go back to the model: a tier-1 turn after the start
    // (an import's summary) would read as the model claiming it imported.
    // It stays a window turn, in its place among the chat turns.
    const ctx = skillCtx(getUser()?.pubkey);
    /** @type {any[]} */
    const messages = [];
    conv.turns.slice(start).forEach((t, i) => {
      if (i === 0 || t.tier === 2) {
        const msg = toUIMessage(t, `${conv.id}-${start + i}`);
        // already in the restored state: never folded a second time
        for (const p of /** @type {any[]} */ (msg.parts))
          if (p.toolCallId) folded.add(p.toolCallId);
        messages.push(msg);
        return;
      }
      const turn = readOnlyTurn(t, ctx);
      side.set(/** @type {string} */ (turn.id), { at: messages.length, stored: t });
      local = [...local, turn];
    });
    assistant.chat.messages = messages;
  }

  function newConversation() {
    restart();
    history?.startNew();
  }

  /** @param {string} id */
  async function removeConversation(id) {
    if (!history) return;
    const wasCurrent = history.current?.id === id;
    try {
      await history.remove(id);
    } catch (err) {
      console.warn('[termi] conversation remove failed:', err);
    }
    // otherwise the next record would save the window again under a new id
    if (wasCurrent) restart();
  }

  /** @param {string} text */
  async function routeAnswer(text) {
    /** @type {NewTurn | null} */
    let reply;
    let content = false; // a tier-1 content answer: the only router reply worth recording
    const locale = localeOf();
    const user = getUser();
    // The task is fixed by the first chat (or an opened record); until then a
    // tier-1 or router reply leaves it open on purpose, so the next question picks it.
    const chatTask = taskFixed ? task : detectTask(text);
    // The eligibility probe runs alongside the router request.
    const llm = canUseAssistant(user)
      ? isTermiEligible(user.pubkey, fetch)
      : Promise.resolve(false);
    try {
      // A lesson request is never a navigate/create/help skill: straight to the lesson chat.
      if (chatTask === 'lesson' && (await llm)) {
        await startAssistant(text, user, chatTask);
        return;
      }
      // Ineligible: say why, then the router and its tier-1 material as for any other question.
      if (chatTask === 'lesson' && !destroyed && user?.pubkey === getUser()?.pubkey)
        append({ role: 'assistant', text: m.termi_lesson_needs_assistant() });
      const { decision, available, guesses, strongGuesses } = await routeQuestion(text, {
        locale,
        fetch,
        // help.3 points at the guide: like its chip, only offered with a HELP_URL.
        skills: helpLink() ? TERMI_SKILLS : TERMI_SKILLS.filter((s) => s.id !== 'help.3'),
        ctx: { loggedIn: !!user }
      });
      reply = routerReply(decision, available, user?.pubkey);
      /** @param {string[]} list */
      const toSkills = (list) =>
        /** @type {TermiSkill[]} */ (
          list.map((id) => available.find((s) => s.id === id)).filter(Boolean)
        );
      guessSkills = toSkills(guesses);
      strongGuessSkills = toSkills(strongGuesses);
      if (!reply) {
        // A content question: tier 2 (the chat of this conversation's task) when allowed, else tier 1.
        if (await llm) {
          await startAssistant(text, user, chatTask);
          return;
        }
        const result = await searchContent(text, { locale, fetch });
        content = true;
        reply = contentReply(result, text, undefined, {
          loose: guessSkills,
          strict: strongGuessSkills
        });
      }
    } catch {
      reply = fallbackReply();
    }
    if (destroyed) return;
    botTyping = false;
    // Switched meanwhile: the answer belonged to the other account.
    if (user?.pubkey !== getUser()?.pubkey) return;
    append(reply, content ? { retry: () => contentSearch(text) } : {});
    if (content) saveHistory();
  }

  /**
   * Tier 1 results as cards; nothing left after the card filter → the fallback line (plus the sources note).
   * @param {Awaited<ReturnType<typeof searchContent>>} result
   * @param {string} text the question, for "Erneut versuchen" and "Alle anzeigen"
   * @param {string[]} [authors] set for "Material von …": no topic, no "Alle anzeigen"
   * @param {{ loose: TermiSkill[], strict: TermiSkill[] }} [guesses] the router's guesses ("Meinst du …?"): loose for an empty answer, strict beside cards
   * @returns {NewTurn} its retry (`contentSearch` with the same arguments) goes in `side`
   */
  function contentReply({ items, sourcesUnavailable }, text, authors, guesses) {
    const kept = items.filter(keepItem);
    if (kept.length === 0) return { ...fallbackReply(guesses?.loose), sourcesUnavailable };
    const query = authors ? '' : extractQuery(text, localeOf());
    const actions = guessActions(guesses?.strict);
    return {
      role: 'assistant',
      text: actions.length ? m.termi_route_maybe() : m.termi_route_go(),
      ...(actions.length ? { actions } : {}),
      items: kept,
      sourcesUnavailable,
      query
    };
  }

  /** Tier 1 again (retry, "Material von …"), outside the router. @param {string} text @param {string[]} [authors] */
  async function contentSearch(text, authors) {
    if (botTyping) return;
    botTyping = true;
    const pubkey = getUser()?.pubkey;
    const result = await searchContent(text, { locale: localeOf(), fetch, authors });
    if (destroyed) return;
    botTyping = false;
    if (pubkey !== getUser()?.pubkey) return;
    append(contentReply(result, text, authors), { retry: () => contentSearch(text, authors) });
    saveHistory();
  }

  /**
   * "Material von …" on a person card: in the chat when one runs, else tier 1
   * by the person's key (a name-only person: by the name as text).
   * @param {Item} person
   * @param {(text: string) => unknown} [send] the window's send, so the composer behaves as for typed text
   */
  function searchAuthor(person, send = ask) {
    const label = m.termi_card_author_search({ name: person.title });
    // The model needs the hex key to pass as `authors`; a name alone would be a text search.
    if (assistant) return send(person.pubkey ? `${label} (${person.pubkey})` : label);
    if (botTyping) return;
    append({ role: 'user', text: label });
    contentSearch(person.title, person.pubkey ? [person.pubkey] : undefined);
  }

  /**
   * The "can't answer" line plus home, the learning search and help, led by
   * the router's guesses when it had any ("Meinst du …?").
   * @param {TermiSkill[]} [guesses]
   * @returns {NewTurn & { actions: TermiAction[] }}
   */
  function fallbackReply(guesses = []) {
    const home = TERMI_SKILLS.find((s) => s.id === 'home');
    const help = TERMI_SKILLS.find((s) => s.id === 'help.1');
    const types = runtimeConfig.discover?.contentTypes ?? [];
    const guessed = guessActions(guesses);
    const link = helpLink();
    /** @type {Array<TermiAction | null>} */
    const list = [
      ...guessed,
      home ? skillAction(home, skillCtx()) : null,
      // Unrecognised text is no search query: offer the plain search page.
      isDiscoverTypeEnabled('learning', types)
        ? {
            label: m.termi_route_browse_label({ type: m.discover_tab_learning() }),
            href: discoverHref('learning')
          }
        : null,
      link ? { label: m.termi_sugg_4_link(), ...link } : help ? skillAction(help, skillCtx()) : null
    ];
    return {
      role: 'assistant',
      text: `${m.termi_nothing_found()} ${guessed.length ? m.termi_route_maybe() : m.termi_route_fallback_actions()}`,
      actions: /** @type {TermiAction[]} */ (list.filter(Boolean))
    };
  }

  /**
   * The router's guesses as buttons; home is left to the fallback's own home button.
   * @param {TermiSkill[]} [guesses]
   * @returns {TermiAction[]}
   */
  function guessActions(guesses = []) {
    const ctx = skillCtx(getUser()?.pubkey);
    return /** @type {TermiAction[]} */ (
      guesses
        .filter((s) => s.id !== 'home')
        .map((s) => skillAction(s, ctx))
        .filter(Boolean)
    );
  }

  /** @param {string} [pubkey] @returns {import('$lib/termi/tool-registry.js').ToolActionCtx} */
  function skillCtx(pubkey) {
    return {
      skillById,
      skillAction,
      npub: pubkey ? nip19.npubEncode(pubkey) : null,
      runCreate: (/** @type {import('$lib/config/create-actions.js').CreateAction} */ action) =>
        runCreateAction(action, { goto, resolve: (path) => resolve(/** @type {any} */ (path)) }),
      runHelp: (/** @type {TermiSkill} */ skill) => {
        append(helpReply(skill));
      }
    };
  }

  /** @param {TermiSkill} skill @returns {NewTurn} */
  function helpReply(skill) {
    const guide = skill.helpIndex === 3 && helpLink();
    return {
      role: 'assistant',
      text: helpAnswer(skill),
      ...(guide ? { actions: [{ label: m.termi_sugg_4_link(), ...guide }] } : {})
    };
  }

  /**
   * A navigate/create/help answer, or null for a content question.
   * @param {ReturnType<typeof import('$lib/helpers/termi-skills.js').decide>} decision
   * @param {TermiSkill[]} available
   * @param {string | undefined} pubkey
   * @returns {NewTurn | null}
   */
  function routerReply(decision, available, pubkey) {
    const ctx = skillCtx(pubkey);
    /** @param {string} id */
    const skillOf = (id) => available.find((s) => s.id === id);
    /** @param {string} id */
    const actionOf = (id) => {
      const skill = skillOf(id);
      return skill ? skillAction(skill, ctx) : null;
    };

    if (decision.kind === 'confident') {
      const skill = skillOf(decision.skill);
      if (skill?.kind === 'help') return helpReply(skill);
      const action = actionOf(decision.skill);
      if (action) return { role: 'assistant', text: m.termi_route_go(), actions: [action] };
    }
    // "Meinst du …?" only between ≥ 2 skills; one weak match is a content question.
    if (decision.kind === 'maybe') {
      const actions = /** @type {TermiAction[]} */ (decision.skills.map(actionOf).filter(Boolean));
      if (actions.length >= 2) return { role: 'assistant', text: m.termi_route_maybe(), actions };
    }
    return null;
  }

  // Import turns (the pipeline itself still lives in the window), keyed by the answer turn's id.
  /** @param {string} id */
  const importTurn = (id) => local.find((x) => x.id === id && x.import);
  /** @param {string} id */
  const fileOf = (id) => side.get(id)?.file;
  /** @param {string} id @param {Partial<ImportState>} patch */
  function patchImport(id, patch) {
    local = local.map((x) =>
      x.id === id && x.import ? { ...x, import: { ...x.import, ...patch } } : x
    );
    // a published import is never re-read: let go of its File
    if (patch.status === 'done') delete side.get(id)?.file;
  }
  /** The import's answer becomes a plain line. @param {string} id @param {string} text */
  function replaceImport(id, text) {
    local = local.map((x) => (x.id === id ? { id, role: 'assistant', tier: 1, text } : x));
    // a plain line now: no File to read again; `at` keeps its place among the chat turns
    delete side.get(id)?.file;
  }

  function dispose() {
    destroyed = true;
    clearTimeout(replyTimer);
    assistant?.chat.stop();
  }

  return {
    /** The whole conversation as the window renders it. */
    get turns() {
      return interleave(chatTurn, errorTurn);
    },
    get assistant() {
      return assistant;
    },
    /** 'ask' | 'lesson': the server task of this conversation. */
    get task() {
      return task;
    },
    /** The lesson task's phase state (null until the model wrote one). */
    get lessonState() {
      return lessonState;
    },
    /** Her files for the series. */
    get materials() {
      return materials;
    },
    get botTyping() {
      return botTyping;
    },
    get history() {
      return history;
    },
    get historyReady() {
      return historyReady;
    },
    get suggestions() {
      return suggestions();
    },
    get chatBusy() {
      return chatBusy();
    },
    get chatError() {
      return chatError();
    },
    ask,
    talk,
    restart,
    searchAuthor,
    visible,
    retryOf,
    canPick,
    addMaterial,
    getBodyExtras,
    setArtifacts,
    replaceTurnText,
    recordPartWrap,
    recordPublished,
    conversationId,
    actionStateOf,
    setActionState,
    assistantAllowed,
    syncAccount,
    observeChatStatus,
    connectHistory,
    turnsNow,
    saveHistory,
    openConversation,
    newConversation,
    removeConversation,
    append,
    importPrompt,
    importTurn,
    fileOf,
    patchImport,
    replaceImport,
    dispose
  };
}
