// Termi's conversation, without the window: canned and router replies, the
// tier-1 content path, the tier-2 `ask` chat (start, talk, 503 → fallback,
// 403 → ineligible, 429/upstream → rescue), the account-switch reset and the
// history save/restore. Moved out of TermiChatWindow unchanged; the window
// keeps the view state (input, drag, history list open) and the templates.
//
// The conversation still lives in three lists — `msgs` (router, tier 1,
// restored, imports when no chat), `assistant.chat.messages` (message 0 is
// the router bubble, never rendered twice) and `imports` (import bubbles
// while a chat runs). Effects stay in the window; it calls `syncAccount`,
// `observeChatStatus` and `connectHistory` from them.
import * as m from '$lib/paraglide/messages';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { helpLinkAttrs } from '$lib/helpers/help-link.js';
import { matchSuggestion } from '$lib/helpers/assistant-hints.js';
import { hasNip44 } from '$lib/helpers/nip44.js';
import {
  fromTier1Message,
  fromUIMessage,
  toTier1Message,
  toUIMessage
} from './history/conversation-codec.js';
import { isKnowledgeTool, toolNameOf } from '$lib/termi/tool-registry.js';
import { unique } from '$lib/helpers/unique.js';
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
/**
 * @typedef {{
 *   role: 'user' | 'bot', text: string, link?: Suggestion['link'], actions?: TermiAction[],
 *   items?: Array<Item>, sourcesUnavailable?: string[],
 *   retry?: () => void, query?: string, sourcesLost?: boolean,
 *   importId?: number, file?: File, import?: ImportState, importOf?: number
 * }} ChatMessage
 */
/** @typedef {{ chat: import('@ai-sdk/svelte').Chat, reset: () => void }} TermiAssistantChat */
/** @typedef {ReturnType<typeof import('./history/conversation-store.svelte.js').createConversationStore>} ConversationStore */
/** @typedef {{ createConversationStore: (opts: any) => ConversationStore, createRelaySync: (opts: any) => any }} HistoryModule */

/** @param {any} msg */
export const textOf = (msg) =>
  msg.parts
    .filter((/** @type {any} */ p) => p.type === 'text')
    .map((/** @type {any} */ p) => p.text)
    .join('')
    .trim(); // some models (qwen) lead with blank lines
// Knowledge tools' outputs are `{ items, sourcesUnavailable }` (the tool registry).
/** @param {any} p */
const isKnowledgePart = (p) => isKnowledgeTool(toolNameOf(p));
/** @param {any} msg */
export const searchPartsOf = (msg) =>
  msg.parts.filter((/** @type {any} */ p) => isKnowledgePart(p) && p.state === 'output-available');
// find_people (name) and search_passages (question) carry no query: the first part that has one.
/** @param {any[]} parts @returns {string} */
const firstQuery = (parts) =>
  parts.find((p) => typeof p.input?.query === 'string' && p.input.query)?.input?.query ?? '';
// All knowledge tool outputs of one answer as ONE card list: the model often calls
// several tools for one question; ItemCards dedupes the items by type:id.
/** @param {any} msg */
export const searchOf = (msg) => {
  const parts = searchPartsOf(msg);
  return {
    items: /** @type {Item[]} */ (parts.flatMap((/** @type {any} */ p) => p.output?.items ?? [])),
    sourcesUnavailable: /** @type {string[]} */ (
      unique(parts.flatMap((/** @type {any} */ p) => p.output?.sourcesUnavailable ?? []))
    ),
    query: firstQuery(parts)
  };
};
// show_pages is not a knowledge tool: never counts toward emptyAnswer/searchFailed.
/** @param {any} p */
const isShowPagesPart = (p) => toolNameOf(p) === 'show_pages';
/** @param {any} msg */
const showPagesPartsOf = (msg) =>
  msg.parts.filter((/** @type {any} */ p) => isShowPagesPart(p) && p.state === 'output-available');
/** LiaScript draft naddr: on a router message, or in a chat message's metadata. @param {any} msg */
export const draftOf = (msg) => msg.draftNaddr ?? msg.metadata?.draftNaddr;

/**
 * @param {{
 *   getUser: () => any,
 *   getLocale?: () => string,
 *   fetch?: typeof fetch,
 *   loadHistoryStore?: () => Promise<HistoryModule>,
 *   chatFactory?: (opts: { task: 'ask', user: any }) => Promise<TermiAssistantChat>,
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
  const getActiveUser = getUser;
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

  /** @type {ChatMessage[]} */
  let msgs = $state.raw([]);
  // Import bubbles while a tier-2 chat runs: rendered (and recorded) after the chat, never mid-history.
  /** @type {ChatMessage[]} */
  let imports = $state.raw([]);
  let botTyping = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let replyTimer;
  // Plain let: an assistant start still waiting on its chunk must not sign or send after close.
  let destroyed = false;

  // Assistant mode: an AI chat (/api/termi/chat, task `ask`), started by a
  // content question when the account may use it. Memory only.
  let assistant = $state.raw(/** @type {TermiAssistantChat | null} */ (null));
  // Getters, not $derived: they read the Chat's own state, so a fake chat in a test works too.
  const chatBusy = () =>
    !!assistant && (assistant.chat.status === 'submitted' || assistant.chat.status === 'streaming');
  const chatError = () =>
    /** @type {(Error & { status?: number, scope?: string }) | undefined} */ (
      assistant?.chat.error
    );

  /** @param {any} msg @returns {TermiAction[]} */
  const pageActionsOf = (msg) => {
    const ctx = skillCtx(getActiveUser()?.pubkey);
    const ids = showPagesPartsOf(msg).flatMap((/** @type {any} */ p) => p.output?.ids ?? []);
    return /** @type {TermiAction[]} */ (
      ids
        .map((/** @type {string} */ id) => skillById(id))
        .filter(Boolean)
        .filter((/** @type {any} */ s) => !s.requiresUser || ctx.npub)
        .map((/** @type {any} */ s) => skillAction(s, ctx))
        .filter(Boolean)
    );
  };
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
  /** @param {any} msg */
  const emptyAnswer = (msg) =>
    msg.role === 'assistant' &&
    !textOf(msg) &&
    !searchFailed(msg) &&
    !searchPartsOf(msg).some((/** @type {any} */ p) => (p.output?.items ?? []).some(keepItem)) &&
    pageActionsOf(msg).length === 0 &&
    !lastStreaming(msg) &&
    !chatError();
  /** @param {any} msg */
  const visible = (msg) =>
    msg.role === 'user' ||
    !!textOf(msg) ||
    searchPartsOf(msg).length > 0 ||
    searchFailed(msg) ||
    pageActionsOf(msg).length > 0 ||
    emptyAnswer(msg);
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

  /** @param {any} msg @param {string} naddr */
  function keepDraft(msg, naddr) {
    if (msg.parts && assistant) {
      assistant.chat.messages = assistant.chat.messages.map((x) =>
        x.id === msg.id
          ? /** @type {any} */ ({
              ...x,
              metadata: { .../** @type {any} */ (x).metadata, draftNaddr: naddr }
            })
          : x
      );
    } else msgs = msgs.map((x) => (x === msg ? { ...x, draftNaddr: naddr } : x));
    saveHistory();
  }

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
    msgs = [...msgs, { role: 'user', text: q.trim() }];
    botTyping = true;
    if (!match && runtimeConfig.termi?.enabled) {
      routeAnswer(q.trim());
      return true;
    }
    replyTimer = setTimeout(() => {
      botTyping = false;
      msgs = [
        ...msgs,
        match
          ? { role: 'bot', text: match.a, link: match.link }
          : { role: 'bot', text: m.termi_fallback() }
      ];
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
    leaveAssistant();
    botTyping = true;
    const pubkey = getActiveUser()?.pubkey;
    const locale = localeOf();
    const result = await searchContent(sentence, { locale, fetch });
    if (destroyed) return;
    botTyping = false;
    // Switched meanwhile: the answer belonged to the other account.
    if (pubkey !== getActiveUser()?.pubkey) return;
    const reply = contentReply(result, sentence);
    // Nothing kept: the line plus the learning search; the sources note and retry stay.
    const search = {
      label: m.termi_quota_link(),
      href: learningHref(extractQuery(sentence, locale))
    };
    msgs = [...msgs, { ...reply, text: line, ...(reply.items ? {} : { actions: [search] }) }];
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

  /** @param {string} text the user's question, already shown as the router bubble */
  async function startAssistant(text) {
    const user = getActiveUser();
    // Answered from the probe cache: routeAnswer already asked.
    const allowed = await assistantAllowed(user);
    if (destroyed) return;
    // Switched meanwhile: the question belonged to the other account, drop it quietly.
    if (user?.pubkey !== getActiveUser()?.pubkey) {
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
    const created = await chatFactory({ task: 'ask', user });
    if (destroyed || user?.pubkey !== getActiveUser()?.pubkey) return;
    assistantPubkey = user.pubkey;
    assistant = created;
    botTyping = false;
    await talk((chat) => chat.sendMessage({ text }));
  }

  /** An account switch ends the chat: it was signed, and gated, as the old account. @param {string | undefined} pubkey */
  function syncAccount(pubkey) {
    if (assistant && pubkey !== assistantPubkey) restart();
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
      // 429 with no scope is `busy` (another tab's request in flight for this
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
    msgs = [...msgs, ...imports];
    imports = [];
  }

  function restart() {
    leaveAssistant();
    msgs = [];
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
    });
    return () => {
      cancelled = true;
      store?.dispose();
      history = null;
    };
  }

  /** The user bubble of an import. @param {ImportState} s */
  const importPrompt = (s) => s.instruction || m.termi_import_default_prompt({ file: s.source });

  /** The conversation as turns: `msgs` (an import only once published, as its summary) + the chat after its first message. @returns {Turn[]} */
  function turnsNow() {
    /** @param {ChatMessage} x @returns {Turn[]} */
    const tier1 = (x) => {
      // the import's question is recorded with its summary, only once published
      if (x.importOf) return [];
      if (x.import) {
        if (x.import.status !== 'done') return [];
        const n = x.import.result?.ok.length ?? 0;
        const text = m.termi_history_import_summary({ n, file: x.import.source });
        return [
          { role: 'user', text: importPrompt(x.import), tier: 1 },
          { role: 'assistant', text, tier: 1 }
        ];
      }
      return x.text || x.items ? [fromTier1Message(x)] : [];
    };
    return [
      ...msgs.flatMap(tier1),
      ...(assistant?.chat.messages.slice(1).map(fromUIMessage) ?? []),
      ...imports.flatMap(tier1)
    ];
  }

  function saveHistory() {
    const turns = turnsNow();
    if (history && turns.some((t) => t.role === 'assistant')) history.record(turns);
  }

  // A finished tier-2 answer (streaming → ready) is recorded; a restore does not pass through streaming.
  /** @type {string | undefined} */
  let lastChatStatus;
  /** @param {string | undefined} status the chat's status, from the window's effect */
  function observeChatStatus(status) {
    if (status === 'ready' && lastChatStatus && lastChatStatus !== 'ready') saveHistory();
    lastChatStatus = status;
  }

  /** A stored turn as a read-only window message; tier-2 tool outputs become cards. @param {Turn} t @returns {ChatMessage} */
  function restoredMessage(t) {
    if (t.tier !== 2 || t.role !== 'assistant') {
      return /** @type {ChatMessage} */ (toTier1Message(t));
    }
    const toolParts = t.toolParts ?? [];
    const outputs = toolParts.map((p) => p.output ?? {});
    const ctx = skillCtx(getActiveUser()?.pubkey);
    const actions = /** @type {TermiAction[]} */ (
      outputs
        .flatMap((o) => o.ids ?? [])
        .map((/** @type {string} */ id) => skillById(id))
        .filter((/** @type {any} */ s) => s && (!s.requiresUser || ctx.npub))
        .map((/** @type {any} */ s) => skillAction(s, ctx))
        .filter(Boolean)
    );
    const msg = /** @type {ChatMessage} */ (
      toTier1Message({
        ...t,
        items: outputs.flatMap((o) => o.items ?? []),
        sourcesUnavailable: unique(outputs.flatMap((o) => o.sourcesUnavailable ?? []))
      })
    );
    const query = firstQuery(toolParts);
    if (query) msg.query = query;
    return actions.length ? { ...msg, actions } : msg;
  }

  /**
   * Tier-2 turns continue in the chat only when it runs for this account; the
   * first question goes to `msgs` (the chat render skips message 0). Otherwise
   * everything is read-only and a follow-up starts a fresh context.
   * @param {string} id
   * @returns {Promise<boolean>} false when nothing was opened
   */
  async function openConversation(id) {
    if (!history) return false;
    /** @type {import('./history/conversation-codec.js').Conversation} */
    let conv;
    try {
      conv = await history.open(id);
    } catch (err) {
      console.warn('[termi] conversation open failed:', err);
      return false;
    }
    rescue = null;
    guessSkills = [];
    strongGuessSkills = [];
    // The router question is recorded from `msgs` (tier 1); the chat starts with it.
    const t2 = conv.turns.findIndex((t) => t.tier === 2);
    const start = t2 > 0 && conv.turns[t2 - 1].role === 'user' ? t2 - 1 : t2;
    if (assistant && start >= 0 && conv.turns[start].role === 'user') {
      // reset() must not look like a finished answer: no re-save of the old window
      lastChatStatus = 'ready';
      assistant.reset();
      imports = [];
      msgs = conv.turns.slice(0, start + 1).map(restoredMessage);
      assistant.chat.messages = /** @type {any} */ (
        conv.turns.slice(start).map((t, i) => toUIMessage(t, `${conv.id}-${start + i}`))
      );
      return true;
    }
    leaveAssistant();
    msgs = conv.turns.map(restoredMessage);
    return true;
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
    /** @type {ChatMessage | null} */
    let reply;
    let content = false; // a tier-1 content answer: the only router reply worth recording
    const locale = localeOf();
    const user = getActiveUser();
    // The eligibility probe runs alongside the router request.
    const llm = canUseAssistant(user)
      ? isTermiEligible(user.pubkey, fetch)
      : Promise.resolve(false);
    try {
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
        // A content question: tier 2 (the `ask` chat) when allowed, else tier 1.
        if (await llm) {
          await startAssistant(text);
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
    if (user?.pubkey !== getActiveUser()?.pubkey) return;
    msgs = [...msgs, reply];
    if (content) saveHistory();
  }

  /**
   * Tier 1 results as cards; nothing left after the card filter → the fallback line (plus the sources note).
   * @param {Awaited<ReturnType<typeof searchContent>>} result
   * @param {string} text the question, for "Erneut versuchen" and "Alle anzeigen"
   * @param {string[]} [authors] set for "Material von …": no topic, no "Alle anzeigen"
   * @param {{ loose: TermiSkill[], strict: TermiSkill[] }} [guesses] the router's guesses ("Meinst du …?"): loose for an empty answer, strict beside cards
   * @returns {ChatMessage}
   */
  function contentReply({ items, sourcesUnavailable }, text, authors, guesses) {
    const retry = () => contentSearch(text, authors);
    const kept = items.filter(keepItem);
    if (kept.length === 0) return { ...fallbackReply(guesses?.loose), sourcesUnavailable, retry };
    const query = authors ? '' : extractQuery(text, localeOf());
    const actions = guessActions(guesses?.strict);
    return {
      role: 'bot',
      text: actions.length ? m.termi_route_maybe() : m.termi_route_go(),
      ...(actions.length ? { actions } : {}),
      items: kept,
      sourcesUnavailable,
      retry,
      query
    };
  }

  /** Tier 1 again (retry, "Material von …"), outside the router. @param {string} text @param {string[]} [authors] */
  async function contentSearch(text, authors) {
    if (botTyping) return;
    botTyping = true;
    const pubkey = getActiveUser()?.pubkey;
    const result = await searchContent(text, { locale: localeOf(), fetch, authors });
    if (destroyed) return;
    botTyping = false;
    if (pubkey !== getActiveUser()?.pubkey) return;
    msgs = [...msgs, contentReply(result, text, authors)];
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
    msgs = [...msgs, { role: 'user', text: label }];
    contentSearch(person.title, person.pubkey ? [person.pubkey] : undefined);
  }

  /**
   * The "can't answer" line plus home, the learning search and help, led by
   * the router's guesses when it had any ("Meinst du …?").
   * @param {TermiSkill[]} [guesses]
   * @returns {ChatMessage}
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
      role: 'bot',
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
    const ctx = skillCtx(getActiveUser()?.pubkey);
    return /** @type {TermiAction[]} */ (
      guesses
        .filter((s) => s.id !== 'home')
        .map((s) => skillAction(s, ctx))
        .filter(Boolean)
    );
  }

  /** @param {string} [pubkey] */
  function skillCtx(pubkey) {
    return {
      npub: pubkey ? nip19.npubEncode(pubkey) : null,
      runCreate: (/** @type {import('$lib/config/create-actions.js').CreateAction} */ action) =>
        runCreateAction(action, { goto, resolve: (path) => resolve(/** @type {any} */ (path)) }),
      runHelp: (/** @type {TermiSkill} */ skill) => {
        msgs = [...msgs, helpReply(skill)];
      }
    };
  }

  /** @param {TermiSkill} skill @returns {ChatMessage} */
  function helpReply(skill) {
    const guide = skill.helpIndex === 3 && helpLink();
    return {
      role: 'bot',
      text: helpAnswer(skill),
      ...(guide ? { actions: [{ label: m.termi_sugg_4_link(), ...guide }] } : {})
    };
  }

  /**
   * A navigate/create/help answer, or null for a content question.
   * @param {ReturnType<typeof import('$lib/helpers/termi-skills.js').decide>} decision
   * @param {TermiSkill[]} available
   * @param {string | undefined} pubkey
   * @returns {ChatMessage | null}
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
      if (action) return { role: 'bot', text: m.termi_route_go(), actions: [action] };
    }
    // "Meinst du …?" only between ≥ 2 skills; one weak match is a content question.
    if (decision.kind === 'maybe') {
      const actions = /** @type {TermiAction[]} */ (decision.skills.map(actionOf).filter(Boolean));
      if (actions.length >= 2) return { role: 'bot', text: m.termi_route_maybe(), actions };
    }
    return null;
  }

  // Import bubbles (the pipeline itself still lives in the window).
  /** @param {number} id */
  const importMsg = (id) => [...msgs, ...imports].find((x) => x.importId === id);
  /** @param {(list: ChatMessage[]) => ChatMessage[]} f both lists: a bubble may sit in either */
  function mapImports(f) {
    msgs = f(msgs);
    imports = f(imports);
  }
  /** @param {number} id @param {Partial<ImportState>} patch */
  function patchImport(id, patch) {
    mapImports((list) =>
      list.map((x) =>
        x.importId === id && x.import ? { ...x, import: { ...x.import, ...patch } } : x
      )
    );
  }
  /** @param {number} id @param {ChatMessage | null} replacement */
  function replaceImport(id, replacement) {
    mapImports((list) =>
      list.flatMap((x) => (x.importId === id ? (replacement ? [replacement] : []) : [x]))
    );
  }
  /** After the chat while one runs, else in the router's list. @param {ChatMessage} msg */
  function pushImportBubble(msg) {
    if (assistant) imports = [...imports, msg];
    else msgs = [...msgs, msg];
  }

  function dispose() {
    destroyed = true;
    clearTimeout(replyTimer);
    assistant?.chat.stop();
  }

  return {
    get msgs() {
      return msgs;
    },
    get imports() {
      return imports;
    },
    get assistant() {
      return assistant;
    },
    get botTyping() {
      return botTyping;
    },
    get rescue() {
      return rescue;
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
    get chatSentence() {
      return chatSentence();
    },
    get chatQuery() {
      return chatQuery();
    },
    get lastAssistantId() {
      return lastAssistantId();
    },
    ask,
    talk,
    restart,
    fallBackToContent,
    searchAuthor,
    fallbackReply,
    guessActions,
    guessesFor,
    learningHref,
    pageActionsOf,
    lastStreaming,
    searchFailed,
    emptyAnswer,
    visible,
    keepDraft,
    assistantAllowed,
    syncAccount,
    observeChatStatus,
    connectHistory,
    turnsNow,
    saveHistory,
    openConversation,
    newConversation,
    removeConversation,
    importPrompt,
    importMsg,
    patchImport,
    replaceImport,
    pushImportBubble,
    dispose
  };
}
