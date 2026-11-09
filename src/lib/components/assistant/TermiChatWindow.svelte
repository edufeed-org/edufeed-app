<script>
  // Termi chat window — popover (default) or side panel (expanded). Account
  // hints render as proactive bot messages with real actions; free-text input
  // is matched against canned suggestions; with TERMI_AI_ENABLED anything
  // else goes through the router (/api/termi, keyword fallback) for
  // navigate/create/help, and every other question to the content path.
  import { getFirstPendingInvite } from '$lib/concord/pending-invites.svelte.js';
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { helpLinkAttrs } from '$lib/helpers/help-link.js';
  import { formatFileSize } from '$lib/helpers/media-meta.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { matchSuggestion } from '$lib/helpers/assistant-hints.js';
  import { CheckIcon, ClockIcon, CloseIcon, SendIcon } from '$lib/components/icons';
  import { hasNip44 } from '$lib/helpers/nip44.js';
  import ConversationList from './history/ConversationList.svelte';
  import {
    fromTier1Message,
    fromUIMessage,
    toTier1Message,
    toUIMessage
  } from './history/conversation-codec.js';
  import TermiAvatar from './TermiAvatar.svelte';
  import { localToday } from './termi-chat-request.js';
  import TermiAnswer from './TermiAnswer.svelte';
  import ItemCards from './cards/ItemCards.svelte';
  import ImportPreviewCard from './import/ImportPreviewCard.svelte';
  import { keepItem } from './cards/filter.js';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { getLocale } from '$lib/paraglide/runtime';
  import { TERMI_SKILLS, extractQuery } from '$lib/helpers/termi-skills.js';
  import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
  import { runCreateAction } from '$lib/helpers/run-create-action.js';
  import { canSign } from '$lib/helpers/signing-guard.js';
  import { untrack } from 'svelte';
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

  /**
   * @type {{
   *   expanded?: boolean,
   *   onToggleExpand: () => void,
   *   onClose: () => void,
   *   hints: Array<{id: string, status: string, variant?: string, address?: string, count?: number, relay?: string, replacement?: string | null, days?: number}>,
   *   openCount: number,
   *   runHint: (id: any) => void,
   *   customizeHint: (id: any) => void,
   *   dismissHint: (id: any) => void
   * }}
   */
  let {
    expanded = false,
    onToggleExpand,
    onClose,
    hints,
    openCount,
    runHint,
    customizeHint,
    dismissHint
  } = $props();

  const getActiveUser = useActiveUser();
  const getProfile = useUserProfile();
  const isNsec = $derived(getActiveUser()?.type === 'nsec');

  const greeting = $derived.by(() => {
    const profile = getProfile();
    const name = profile?.display_name || profile?.name;
    return name ? m.termi_greeting_named({ name }) : m.termi_greeting();
  });

  // Per-hint copy — titles/bodies/CTAs reuse the former banner keys so
  // translations stay consistent; "doing" lines are Termi-specific.
  const hintCopy = $derived({
    backup: {
      title: m.auth_backup_banner_title(),
      body: m.auth_backup_banner_body(),
      action: m.auth_backup_banner_download_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    relays: {
      title: m.relay_list_banner_title(),
      body: isNsec ? m.relay_list_banner_body_nsec() : m.relay_list_banner_body(),
      action: m.relay_list_banner_use_cta(),
      secondary: m.relay_list_banner_customize_cta(),
      doing: m.termi_hint_relays_doing(),
      link: null
    },
    dm: {
      title: m.dm_relay_banner_title(),
      body: m.dm_relay_banner_body(),
      action: m.dm_relay_banner_use_cta(),
      secondary: m.dm_relay_banner_customize_cta(),
      doing: m.termi_hint_dm_doing(),
      link: null
    },
    nip05: {
      title: m.termi_hint_nip05_title(),
      body: m.termi_hint_nip05_body({
        domain: `@${runtimeConfig.membership?.handleDomain || ''}`
      }),
      action: m.termi_hint_nip05_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    profile: {
      title: m.termi_hint_profile_title(),
      body: m.termi_hint_profile_body(),
      action: m.termi_hint_profile_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    signer: {
      title: m.termi_hint_signer_title(),
      body: m.termi_hint_signer_body(),
      action: m.termi_hint_signer_cta(),
      secondary: null,
      doing: null,
      link: null
    },
    invites: {
      // Enriched once the invite is decrypted (auto-decrypt makes that the
      // common case): name the area instead of a generic "private area".
      title: getFirstPendingInvite()?.areaName
        ? m.concord_invite_hint_title_known({
            area: /** @type {string} */ (getFirstPendingInvite()?.areaName)
          })
        : m.concord_invite_hint_title(),
      body: m.concord_invite_hint_body(),
      action: m.concord_invite_hint_action(),
      secondary: null,
      doing: null,
      link: null
    }
  });

  // Host of the deployment's own Blossom server, for the storage hints' copy.
  const deploymentBlossomHost = $derived.by(() => {
    try {
      return new URL(runtimeConfig.defaultBlossomServers?.[0] || '').host;
    } catch {
      return '';
    }
  });

  /**
   * The nip05 hint tracks the membership application: the copy depends on the
   * hint's variant ('apply' reminder, passive 'pending' note, celebratory
   * 'ready' card with one-click activation). Other hints use hintCopy as-is.
   * @param {{id: string, variant?: string, address?: string, count?: number, relay?: string, replacement?: string | null, days?: number}} hint
   */
  function copyFor(hint) {
    if (hint.id === 'deadRelay') {
      const relay = (hint.relay || '').replace(/^wss?:\/\//, '');
      const replacement = (hint.replacement || '').replace(/^wss?:\/\//, '');
      const days = hint.days ?? 0;
      return {
        title: m.termi_hint_dead_relay_title(),
        body:
          hint.variant === 'remove'
            ? m.termi_hint_dead_relay_body_remove({ relay, days })
            : m.termi_hint_dead_relay_body({ relay, days, replacement }),
        action:
          hint.variant === 'remove'
            ? m.termi_hint_dead_relay_cta_remove()
            : m.termi_hint_dead_relay_cta(),
        secondary: m.relay_list_banner_customize_cta(),
        doing: m.termi_hint_dead_relay_doing(),
        link: null
      };
    }
    if (hint.id === 'groupAdded') {
      const count = hint.count ?? 0;
      return {
        title: m.termi_hint_group_added_title(),
        body:
          count === 1
            ? m.termi_hint_group_added_body_one()
            : m.termi_hint_group_added_body({ count }),
        action: m.termi_hint_group_added_cta(),
        secondary: null,
        doing: null,
        link: null
      };
    }
    if (hint.id === 'badgeAward') {
      const count = hint.count ?? 0;
      return {
        title: m.termi_hint_badge_award_title(),
        body:
          count === 1
            ? m.termi_hint_badge_award_body_one()
            : m.termi_hint_badge_award_body({ count }),
        action: m.termi_hint_badge_award_cta(),
        secondary: null,
        doing: null,
        link: null
      };
    }
    if (hint.id === 'joinRequests') {
      const count = hint.count ?? 0;
      return {
        title: m.termi_hint_join_requests_title(),
        // Singular/plural picked here — plain {count} interpolation cannot
        // bend the German noun.
        body:
          count === 1
            ? m.termi_hint_join_requests_body_one()
            : m.termi_hint_join_requests_body({ count }),
        action: m.termi_hint_join_requests_cta(),
        secondary: null,
        doing: null,
        link: null
      };
    }
    if (hint.id === 'nip05' && hint.variant === 'ready') {
      return {
        title: m.termi_hint_nip05_ready_title(),
        body: m.termi_hint_nip05_ready_body({ address: hint.address || '' }),
        action: m.termi_hint_nip05_ready_cta(),
        secondary: null,
        doing: m.termi_hint_nip05_ready_doing(),
        link: null
      };
    }
    if (hint.id === 'nip05' && hint.variant === 'pending') {
      return {
        title: m.termi_hint_nip05_pending_title(),
        body: m.termi_hint_nip05_pending_body(),
        action: null,
        secondary: null,
        doing: null,
        link: null
      };
    }
    if (hint.id === 'blossomUpgrade') {
      return {
        title: m.termi_hint_blossom_upgrade_title(),
        body: m.termi_hint_blossom_upgrade_body({ host: deploymentBlossomHost }),
        action: m.termi_hint_blossom_upgrade_cta(),
        secondary: m.termi_hint_blossom_customize_cta(),
        doing: m.termi_hint_blossom_doing(),
        link: null
      };
    }
    if (hint.id === 'blossomPublic') {
      const member = hint.variant === 'member';
      return {
        title: m.termi_hint_blossom_public_title(),
        body: member
          ? m.termi_hint_blossom_public_body_member({
              domain: `@${runtimeConfig.membership?.handleDomain || ''}`
            })
          : m.termi_hint_blossom_public_body(),
        action: m.termi_hint_blossom_public_cta(),
        secondary: m.termi_hint_blossom_customize_cta(),
        doing: m.termi_hint_blossom_doing(),
        // Secondary path for non-members: apply for a handle right here.
        link: member
          ? {
              label: m.termi_hint_blossom_public_apply_link(),
              onClick: () => modalStore.openModal('membershipApply')
            }
          : null
      };
    }
    return hintCopy[
      /** @type {'backup' | 'relays' | 'dm' | 'nip05' | 'profile' | 'signer' | 'invites'} */ (
        hint.id
      )
    ];
  }

  // The user guide (HELP_URL). Only offer the getting-started chip when a
  // deployment has one.
  const helpLink = $derived(helpLinkAttrs(runtimeConfig.help?.url));

  /** @typedef {{ q: string, a: string, link?: { label: string, attrs: NonNullable<ReturnType<typeof helpLinkAttrs>> } }} Suggestion */

  /** @type {Suggestion[]} */
  const suggestions = $derived([
    ...(helpLink
      ? [
          {
            q: m.termi_sugg_4_q(),
            a: m.termi_sugg_4_a(),
            link: { label: m.termi_sugg_4_link(), attrs: helpLink }
          }
        ]
      : []),
    { q: m.termi_sugg_1_q(), a: m.termi_sugg_1_a() },
    { q: m.termi_sugg_2_q(), a: m.termi_sugg_2_a() },
    { q: m.termi_sugg_3_q(), a: m.termi_sugg_3_a() }
  ]);

  /** @typedef {import('./termi-router.js').TermiAction} TermiAction */
  /**
   * @typedef {{
   *   role: 'user' | 'bot', text: string, link?: Suggestion['link'], actions?: TermiAction[],
   *   items?: Array<import('$lib/server/termi/items.js').Item>, sourcesUnavailable?: string[],
   *   retry?: () => void, query?: string,
   *   importId?: number, file?: File, import?: ImportState
   * }} ChatMessage
   */
  /** @typedef {import('./import/publish-imported.js').ImportState} ImportState */

  /** @type {ChatMessage[]} */
  let msgs = $state.raw([]);
  // Import bubbles while a tier-2 chat runs: rendered (and recorded) after the chat, never mid-history.
  /** @type {ChatMessage[]} */
  let imports = $state.raw([]);
  let input = $state('');
  let botTyping = $state(false);
  /** @type {HTMLDivElement | undefined} */
  let bodyEl = $state(undefined);
  /** @type {HTMLTextAreaElement | undefined} */
  let composerEl;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let replyTimer;

  function resetComposerHeight() {
    if (composerEl) composerEl.style.height = '';
  }

  /** @param {KeyboardEvent} e */
  function composerKeydown(e) {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
    e.preventDefault();
    ask(input);
  }

  /** @param {Event} e */
  function growComposer(e) {
    const el = /** @type {HTMLTextAreaElement} */ (e.target);
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 5 * lineHeight) + 'px';
  }

  /** @param {string} q */
  function ask(q) {
    if (!q.trim() || botTyping) return;
    historyOpen = false;
    if (assistant) {
      if (chatBusy) return;
      input = '';
      resetComposerHeight();
      talk((chat) => chat.sendMessage({ text: q.trim() }));
      return;
    }
    const match = matchSuggestion(q, suggestions);
    msgs = [...msgs, { role: 'user', text: q.trim() }];
    input = '';
    resetComposerHeight();
    botTyping = true;
    if (!match && runtimeConfig.termi?.enabled) {
      routeAnswer(q.trim());
      return;
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
  }

  // Plain let: an assistant start still waiting on its chunk must not sign or send after close.
  let destroyed = false;
  $effect(() => () => {
    destroyed = true;
    clearTimeout(replyTimer);
    assistant?.chat.stop();
  });

  // Assistant mode: an AI chat (/api/termi/chat, task `ask`), started by a
  // content question when the account may use it. Memory only; the window owns it.
  /** @typedef {{ chat: import('@ai-sdk/svelte').Chat, reset: () => void }} TermiAssistantChat */
  let assistant = $state.raw(/** @type {TermiAssistantChat | null} */ (null));
  const chatBusy = $derived(
    !!assistant && (assistant.chat.status === 'submitted' || assistant.chat.status === 'streaming')
  );
  const chatError = $derived(
    /** @type {(Error & { status?: number, scope?: string }) | undefined} */ (assistant?.chat.error)
  );
  /** @param {any} msg */
  const textOf = (msg) =>
    msg.parts
      .filter((/** @type {any} */ p) => p.type === 'text')
      .map((/** @type {any} */ p) => p.text)
      .join('')
      .trim(); // some models (qwen) lead with blank lines
  // The `ask` task's knowledge tools (buildTermiTools('ask')); their outputs are `{ items, sourcesUnavailable }`.
  const KNOWLEDGE_TOOLS = new Set([
    'search_content',
    'search_resources',
    'search_events',
    'search_passages',
    'find_community',
    'find_people'
  ]);
  // Both tool-part shapes: `tool-<name>` and `dynamic-tool` with `toolName`.
  /** @param {any} p */
  const isKnowledgePart = (p) =>
    KNOWLEDGE_TOOLS.has(p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, ''));
  /** @param {any} msg */
  const searchPartsOf = (msg) =>
    msg.parts.filter(
      (/** @type {any} */ p) => isKnowledgePart(p) && p.state === 'output-available'
    );
  // show_pages is not a knowledge tool: never counts toward emptyAnswer/searchFailed.
  /** @param {any} p */
  const isShowPagesPart = (p) =>
    (p.type === 'dynamic-tool' ? p.toolName : p.type.replace(/^tool-/, '')) === 'show_pages';
  /** @param {any} msg */
  const showPagesPartsOf = (msg) =>
    msg.parts.filter(
      (/** @type {any} */ p) => isShowPagesPart(p) && p.state === 'output-available'
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
  const lastStreaming = (msg) => chatBusy && assistant?.chat.messages.at(-1)?.id === msg.id;
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
    !chatError;
  /** @param {any} msg */
  const visible = (msg) =>
    msg.role === 'user' ||
    !!textOf(msg) ||
    searchPartsOf(msg).length > 0 ||
    searchFailed(msg) ||
    pageActionsOf(msg).length > 0 ||
    emptyAnswer(msg);
  // The router's guesses belong to the answer to the routed question; follow-ups were never routed.
  const firstAssistantId = $derived(
    assistant?.chat.messages.find((x) => x.role === 'assistant')?.id
  );
  /** @param {any} msg @param {boolean} [beside] next to a real answer: the strict list */
  const guessesFor = (msg, beside = false) =>
    msg.id === firstAssistantId ? (beside ? strongGuessSkills : guessSkills) : [];
  // Only the latest answer can be regenerated.
  const lastAssistantId = $derived(
    assistant?.chat.messages.findLast((x) => x.role === 'assistant')?.id
  );
  const chatSentence = $derived.by(() => {
    const lastUser = assistant?.chat.messages.findLast((x) => x.role === 'user');
    return lastUser ? textOf(lastUser) : '';
  });
  const chatQuery = $derived(
    chatSentence ? extractQuery(chatSentence, getLocale() === 'en' ? 'en' : 'de') : ''
  );
  const learningHref = (/** @type {string} */ q) => discoverHref('learning', q);

  /**
   * The assistant signs every request (no readonly account) and is gated by
   * NIP-05 domain on the server; the probe predicts that answer.
   * @param {ReturnType<typeof getActiveUser>} user
   */
  const canUseAssistant = (user) => !!runtimeConfig.termi?.llm && canSign(user);
  /** @param {ReturnType<typeof getActiveUser>} user */
  const assistantAllowed = async (user) =>
    canUseAssistant(user) && (await isTermiEligible(/** @type {any} */ (user).pubkey, fetch));

  /**
   * Tier 2 refused (gate, off): back to router mode with its line and one
   * tier-1 search for the same sentence — cards, or the plain learning search.
   * @param {string} line @param {string} sentence
   */
  async function fallBackToContent(line, sentence) {
    leaveAssistant();
    botTyping = true;
    const pubkey = getActiveUser()?.pubkey;
    const locale = getLocale() === 'en' ? 'en' : 'de';
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
  /** @type {{ sentence: string, items: Array<import('$lib/server/termi/items.js').Item>, sourcesUnavailable: string[] } | null} */
  let rescue = $state.raw(null);

  /** The router's weak navigate/create/help matches for the routed sentence ("Meinst du …?"). */
  let guessSkills = $state.raw(
    /** @type {import('$lib/helpers/termi-skills.js').TermiSkill[]} */ ([])
  );
  /** The subset safe to show beside real results (keyword mode: full phrase matches only). */
  let strongGuessSkills = $state.raw(
    /** @type {import('$lib/helpers/termi-skills.js').TermiSkill[]} */ ([])
  );

  // Pubkey the current assistant chat signs as; plain let, read by the account-switch effect.
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
    const { createTermiChat } = await import('./termi-chat.svelte.js');
    if (destroyed || user?.pubkey !== getActiveUser()?.pubkey) return;
    assistantPubkey = /** @type {any} */ (user).pubkey;
    assistant = createTermiChat({
      task: 'ask',
      user: /** @type {any} */ (user)
    });
    botTyping = false;
    await talk((chat) => chat.sendMessage({ text }));
  }

  // An account switch ends the chat: it was signed, and gated, as the old account.
  $effect(() => {
    const pubkey = getActiveUser()?.pubkey;
    if (assistant && pubkey !== assistantPubkey) untrack(restart);
  });

  /** @param {(chat: import('@ai-sdk/svelte').Chat) => Promise<void>} run */
  async function talk(run) {
    const current = assistant;
    if (!current) return;
    await run(current.chat);
    if (current !== assistant) return;
    const sentence = chatSentence;
    // 503: LLM/nope-mcp off or eligibility_unknown — back to the router, tier 1 instead.
    if (chatError?.status === 503) fallBackToContent(m.termi_assistant_unavailable(), sentence);
    // 403: the NIP-05 gate refused this account (the probe was stale).
    else if (chatError?.status === 403) {
      if (assistantPubkey) markTermiIneligible(assistantPubkey);
      fallBackToContent(m.termi_assistant_not_eligible(), sentence);
    } else if (
      (chatError?.status === 429 || chatError?.message === 'termi:upstream') &&
      rescue?.sentence !== sentence
    ) {
      botTyping = true;
      const locale = getLocale() === 'en' ? 'en' : 'de';
      const result = await searchContent(sentence, { locale, fetch });
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
  }

  // Conversation history (flag on): one store per account, recreated on a
  // switch; anonymous history lives in sessionStorage only.
  /** @typedef {import('./history/conversation-codec.js').Turn} Turn */
  /** @typedef {ReturnType<typeof import('./history/conversation-store.svelte.js').createConversationStore>} ConversationStore */
  let history = $state.raw(/** @type {ConversationStore | null} */ (null));
  let historyOpen = $state(false);
  const historyScope = $derived(getActiveUser()?.pubkey ?? 'anon');
  /** @type {string | undefined} */
  let lastHistoryScope;
  $effect(() => {
    if (!runtimeConfig.termi?.enabled) return;
    const scope = historyScope;
    // The window's conversation belongs to the old account: never record it into the new one.
    if (lastHistoryScope !== undefined && lastHistoryScope !== scope) untrack(restart);
    lastHistoryScope = scope;
    const user = untrack(getActiveUser);
    let cancelled = false;
    /** @type {ConversationStore | null} */
    let store = null;
    import('./history/conversation-store.svelte.js').then(
      ({ createConversationStore, createRelaySync }) => {
        if (cancelled) return;
        const signer = /** @type {any} */ (user)?.signer;
        store = createConversationStore({
          scope,
          sync: user && hasNip44(signer) ? createRelaySync({ signer, pubkey: scope }) : null
        });
        history = store;
      }
    );
    return () => {
      cancelled = true;
      store?.dispose();
      history = null;
      historyOpen = false;
    };
  });

  /** The window as turns: `msgs` (an import only once published, as its summary) + the chat after its first message. @returns {Turn[]} */
  function turnsNow() {
    /** @param {ChatMessage} x @returns {Turn[]} */
    const tier1 = (x) => {
      if (x.import) {
        if (x.import.status !== 'done') return [];
        const n = x.import.result?.ok.length ?? 0;
        const text = m.termi_history_import_summary({ n, file: x.import.source });
        return [{ role: 'assistant', text, tier: 1 }];
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
  $effect(() => {
    const status = assistant?.chat.status;
    if (status === 'ready' && lastChatStatus && lastChatStatus !== 'ready') untrack(saveHistory);
    lastChatStatus = status;
  });

  /** A stored turn as a read-only window message; tier-2 tool outputs become cards. @param {Turn} t @returns {ChatMessage} */
  function restoredMessage(t) {
    if (t.tier !== 2 || t.role !== 'assistant' || !t.toolParts) {
      return /** @type {ChatMessage} */ (toTier1Message(t));
    }
    const outputs = t.toolParts.map((p) => p.output ?? {});
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
        sourcesUnavailable: outputs.flatMap((o) => o.sourcesUnavailable ?? [])
      })
    );
    return actions.length ? { ...msg, actions } : msg;
  }

  /**
   * Tier-2 turns continue in the chat only when it runs for this account; the
   * first question goes to `msgs` (the chat render skips message 0). Otherwise
   * everything is read-only and a follow-up starts a fresh context.
   * @param {string} id
   */
  async function openConversation(id) {
    if (!history) return;
    /** @type {import('./history/conversation-codec.js').Conversation} */
    let conv;
    try {
      conv = await history.open(id);
    } catch (err) {
      console.warn('[termi] conversation open failed:', err);
      return;
    }
    historyOpen = false;
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
      return;
    }
    leaveAssistant();
    msgs = conv.turns.map(restoredMessage);
  }

  function newConversation() {
    restart();
    history?.startNew();
    historyOpen = false;
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

  function toggleHistory() {
    historyOpen = !historyOpen;
    if (historyOpen) history?.refresh();
  }

  /** @param {string} text */
  async function routeAnswer(text) {
    /** @type {ChatMessage | null} */
    let reply;
    let content = false; // a tier-1 content answer: the only router reply worth recording
    const locale = getLocale() === 'en' ? 'en' : 'de';
    const user = getActiveUser();
    // The eligibility probe runs alongside the router request.
    const llm = canUseAssistant(user)
      ? isTermiEligible(/** @type {any} */ (user).pubkey, fetch)
      : Promise.resolve(false);
    try {
      const { decision, available, guesses, strongGuesses } = await routeQuestion(text, {
        locale,
        fetch,
        // help.3 points at the guide: like its chip, only offered with a HELP_URL.
        skills: helpLink ? TERMI_SKILLS : TERMI_SKILLS.filter((s) => s.id !== 'help.3'),
        ctx: { loggedIn: !!user }
      });
      reply = routerReply(decision, available, user?.pubkey);
      /** @param {string[]} list */
      const toSkills = (list) =>
        /** @type {import('$lib/helpers/termi-skills.js').TermiSkill[]} */ (
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
   * @param {{ loose: import('$lib/helpers/termi-skills.js').TermiSkill[], strict: import('$lib/helpers/termi-skills.js').TermiSkill[] }} [guesses] the router's guesses ("Meinst du …?"): loose for an empty answer, strict beside cards
   * @returns {ChatMessage}
   */
  function contentReply({ items, sourcesUnavailable }, text, authors, guesses) {
    const retry = () => contentSearch(text, authors);
    const kept = items.filter(keepItem);
    if (kept.length === 0) return { ...fallbackReply(guesses?.loose), sourcesUnavailable, retry };
    const query = authors ? '' : extractQuery(text, getLocale() === 'en' ? 'en' : 'de');
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
    const locale = getLocale() === 'en' ? 'en' : 'de';
    const result = await searchContent(text, { locale, fetch, authors });
    if (destroyed) return;
    botTyping = false;
    if (pubkey !== getActiveUser()?.pubkey) return;
    msgs = [...msgs, contentReply(result, text, authors)];
    saveHistory();
  }

  /**
   * "Material von …" on a person card: in the chat when one runs, else tier 1
   * by the person's key (a name-only person: by the name as text).
   * @param {import('$lib/server/termi/items.js').Item} person
   */
  function searchAuthor(person) {
    const label = m.termi_card_author_search({ name: person.title });
    // The model needs the hex key to pass as `authors`; a name alone would be a text search.
    if (assistant) return ask(person.pubkey ? `${label} (${person.pubkey})` : label);
    if (botTyping) return;
    msgs = [...msgs, { role: 'user', text: label }];
    contentSearch(person.title, person.pubkey ? [person.pubkey] : undefined);
  }

  /**
   * The "can't answer" line plus home, the learning search and help, led by
   * the router's guesses when it had any ("Meinst du …?").
   * @param {import('$lib/helpers/termi-skills.js').TermiSkill[]} [guesses]
   * @returns {ChatMessage}
   */
  function fallbackReply(guesses = []) {
    const home = TERMI_SKILLS.find((s) => s.id === 'home');
    const help = TERMI_SKILLS.find((s) => s.id === 'help.1');
    const types = runtimeConfig.discover?.contentTypes ?? [];
    const guessed = guessActions(guesses);
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
      helpLink
        ? { label: m.termi_sugg_4_link(), ...helpLink }
        : help
          ? skillAction(help, skillCtx())
          : null
    ];
    return {
      role: 'bot',
      text: `${m.termi_nothing_found()} ${guessed.length ? m.termi_route_maybe() : m.termi_route_fallback_actions()}`,
      actions: /** @type {TermiAction[]} */ (list.filter(Boolean))
    };
  }

  /**
   * The router's guesses as buttons; home is left to the fallback's own home button.
   * @param {import('$lib/helpers/termi-skills.js').TermiSkill[]} [guesses]
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
      runHelp: (/** @type {import('$lib/helpers/termi-skills.js').TermiSkill} */ skill) => {
        msgs = [...msgs, helpReply(skill)];
      }
    };
  }

  /** @param {import('$lib/helpers/termi-skills.js').TermiSkill} skill @returns {ChatMessage} */
  function helpReply(skill) {
    const guide = skill.helpIndex === 3 && helpLink;
    return {
      role: 'bot',
      text: helpAnswer(skill),
      ...(guide ? { actions: [{ label: m.termi_sugg_4_link(), ...guide }] } : {})
    };
  }

  /**
   * A navigate/create/help answer, or null for a content question.
   * @param {ReturnType<typeof import('$lib/helpers/termi-skills.js').decide>} decision
   * @param {import('$lib/helpers/termi-skills.js').TermiSkill[]} available
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

  // File import: any dropped or picked file → consent → text in the browser →
  // /api/termi/extract (SAIA) → preview → publish. Needs the assistant (its
  // NIP-05 gate and quota); the text leaves the browser only after "Senden".
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const IMPORT_ACCEPT =
    '.pdf,.docx,.xlsx,.odt,.ods,.csv,.tsv,.txt,.md,.ics,.html,.htm,.json,.xml,text/*';
  let importSeq = 0;
  let dragging = $state(false);
  /** @type {HTMLInputElement | undefined} */
  let fileInput = $state();

  /** Import ids whose publishing the user stopped; bookkeeping, never rendered. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const stoppedImports = new Set();

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

  /** Only creates the consent bubble; nothing is read or sent yet. @param {File} file */
  async function receiveFile(file) {
    historyOpen = false;
    if (file.size > MAX_IMPORT_BYTES) {
      pushImportBubble({ role: 'bot', text: m.termi_import_too_large() });
      return;
    }
    const user = getActiveUser();
    const allowed = await assistantAllowed(user);
    if (destroyed) return;
    if (!allowed) {
      const login = { label: m.common_login(), run: () => modalStore.openModal('login') };
      pushImportBubble(
        user
          ? { role: 'bot', text: m.termi_import_needs_assistant() }
          : { role: 'bot', text: m.termi_import_needs_assistant(), actions: [login] }
      );
      return;
    }
    pushImportBubble({
      role: 'bot',
      text: '',
      importId: ++importSeq,
      file,
      import: {
        source: file.name,
        size: formatFileSize(file.size) ?? '0 B',
        status: 'consent',
        withDescriptions: false,
        done: 0
      }
    });
  }

  /** "Senden": read the file, send its text, show the preview. @param {number} id */
  async function sendImport(id) {
    const file = importMsg(id)?.file;
    const user = getActiveUser();
    if (!file || !user) return;
    patchImport(id, { status: 'extracting', quota: undefined });
    try {
      const [{ extractText, toImportEvents }, { requestExtraction }] = await Promise.all([
        import('$lib/helpers/calendar-import/index.js'),
        import('./import/extract-request.js')
      ]);
      const { text, truncated } = await extractText(file);
      if (destroyed) return;
      if (!text.trim()) {
        replaceImport(id, { role: 'bot', text: m.termi_import_no_text() });
        return;
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const raw = await requestExtraction({
        text,
        filename: file.name.slice(0, 200),
        locale: getLocale() === 'en' ? 'en' : 'de',
        today: localToday(),
        tz,
        user: /** @type {any} */ (user)
      });
      const events = toImportEvents(raw, { tz });
      const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte.js');
      if (destroyed) return;
      const already = new Set(
        events
          .filter((e) => e.dTag && eventStore.getReplaceable(e.kind, user.pubkey, e.dTag))
          .map((e) => e.key)
      );
      const selected = new Set(
        events.filter((e) => !e.problem && !already.has(e.key)).map((e) => e.key)
      );
      patchImport(id, { status: 'preview', events, already, selected, truncated, tz });
    } catch (err) {
      if (destroyed) return;
      const e = /** @type {{ status?: number, scope?: string } | null} */ (err);
      if (e?.status === 403) markTermiIneligible(user.pubkey);
      /** @type {ImportState['quota']} */
      let quota;
      if (e?.status === 429) quota = e.scope === 'user' ? 'user' : 'global';
      else if (e?.status === 403) quota = 'ineligible';
      patchImport(id, { status: 'failed', quota });
    }
  }

  /**
   * Publishes the ticked rows, or only `keys` (retry of the failed ones).
   * @param {number} id @param {Set<string>} [keys]
   */
  async function publishImport(id, keys) {
    const state = importMsg(id)?.import;
    if (!state?.events) return;
    const wanted = keys ?? state.selected ?? new Set();
    const list = state.events.filter((e) => !e.problem && wanted.has(e.key));
    const previousOk = keys ? (state.result?.ok ?? []) : [];
    const startPubkey = getActiveUser()?.pubkey;
    stoppedImports.delete(id);
    patchImport(id, { status: 'publishing', selected: new Set(list.map((e) => e.key)), done: 0 });
    let modules;
    try {
      modules = await Promise.all([
        import('$lib/stores/calendar-actions.svelte.js'),
        import('./import/publish-imported.js')
      ]);
    } catch {
      // Chunk load failed (offline, new deploy): every row stays unconfirmed, retry offered.
      if (destroyed) return;
      const failed = list.map((e) => ({ key: e.key, error: 'load_failed' }));
      patchImport(id, { status: 'done', result: { ok: previousOk, failed } });
      return;
    }
    const [{ createCalendarActions }, { publishImportedEvents }] = modules;
    const actions = createCalendarActions('');
    const result = await publishImportedEvents(list, {
      createEvent: (...a) => actions.createEvent(...a),
      withDescriptions: state.withDescriptions,
      tz: state.tz ?? 'UTC',
      onProgress: (done) => patchImport(id, { done }),
      // a switched account must not keep signing the old account's rows
      shouldContinue: () =>
        !destroyed && getActiveUser()?.pubkey === startPubkey && !stoppedImports.has(id)
    });
    if (destroyed || getActiveUser()?.pubkey !== startPubkey) return;
    patchImport(id, {
      status: 'done',
      result: { ok: [...previousOk, ...result.ok], failed: result.failed, skipped: result.skipped }
    });
    saveHistory();
  }

  /** @param {DragEvent} e */
  function onDragOver(e) {
    if (!runtimeConfig.termi?.llm || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragging = true;
  }
  /** @param {DragEvent} e */
  function onDragLeave(e) {
    const root = /** @type {HTMLElement} */ (e.currentTarget);
    if (!root.contains(/** @type {Node | null} */ (e.relatedTarget))) dragging = false;
  }
  /** @param {DragEvent} e */
  function onDrop(e) {
    if (!runtimeConfig.termi?.llm) return;
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) receiveFile(file);
  }

  // Keep the newest message in view. Read the reactive deps before touching
  // the DOM so the effect re-runs on every change.
  $effect(() => {
    void msgs;
    void imports;
    void botTyping;
    void hints;
    void assistant?.chat.messages.at(-1);
    void assistant?.chat.status;
    if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
  });

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<div
  data-testid="termi-window"
  role="dialog"
  aria-label="Termi"
  tabindex="-1"
  onkeydown={onKeydown}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  class="fixed z-[70] flex flex-col overflow-hidden bg-base-100 shadow-2xl {expanded
    ? 'termi-panel-in inset-y-0 right-0 w-[min(560px,100vw)] border-l border-base-300'
    : 'termi-pop-in termi-slot right-4 h-[min(600px,calc(100dvh-10rem))] w-[min(400px,calc(100vw-2rem))] rounded-2xl border border-base-300 lg:right-6'}"
>
  {#if dragging}
    <div
      data-testid="termi-drop-overlay"
      class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-base-100/90 text-sm font-semibold text-primary"
    >
      {m.termi_import_drop()}
    </div>
  {/if}
  <!-- header -->
  <div class="flex items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-3">
    <TermiAvatar size={34} />
    <div class="min-w-0 flex-1">
      <div class="text-[15px] leading-tight font-bold">Termi</div>
      <div class="text-xs leading-tight text-base-content/60">{m.termi_header_sub()}</div>
    </div>
    {#if history}
      <button
        type="button"
        data-testid="termi-history-toggle"
        class="btn btn-circle text-base-content/60 btn-ghost btn-sm"
        aria-label={m.termi_history_aria()}
        aria-pressed={historyOpen}
        title={m.termi_history_aria()}
        onclick={toggleHistory}
      >
        <ClockIcon class_="h-4 w-4" />
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-circle text-base-content/60 btn-ghost btn-sm"
      aria-label={expanded ? m.termi_collapse_aria() : m.termi_expand_aria()}
      title={expanded ? m.termi_collapse_aria() : m.termi_expand_aria()}
      onclick={onToggleExpand}
    >
      {#if expanded}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M8 5H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" /><path d="M16 8l4 4-4 4" /><path
            d="M20 12H10"
          /></svg
        >
      {:else}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M8 5H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" /><path d="M14 8l-4 4 4 4" /><path
            d="M20 12H10"
          /></svg
        >
      {/if}
    </button>
    <button
      type="button"
      class="btn btn-circle text-base-content/60 btn-ghost btn-sm"
      aria-label={m.aria_close_modal()}
      onclick={onClose}
    >
      <CloseIcon class_="h-4 w-4" />
    </button>
  </div>

  <!-- messages, or the history list in their place -->
  {#if historyOpen && history}
    <ConversationList
      conversations={history.list}
      currentId={history.current?.id}
      onOpen={openConversation}
      onNew={newConversation}
      onRemove={removeConversation}
      onBack={() => (historyOpen = false)}
    />
  {:else}
    <div
      bind:this={bodyEl}
      role="log"
      aria-live="polite"
      class="@container flex flex-1 flex-col gap-3 overflow-y-auto p-4"
    >
      <div class="flex items-end gap-2.5">
        <TermiAvatar />
        <div
          class="max-w-[82%] rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-2.5 text-sm leading-relaxed"
        >
          {greeting}
          {#if openCount > 0}
            {openCount === 1
              ? m.termi_greeting_hint_one()
              : m.termi_greeting_hint_many({ count: openCount })}
          {/if}
        </div>
      </div>

      {#each hints as hint (hint.id)}
        {@const copy = copyFor(hint)}
        <div class="flex items-end gap-2.5" data-testid="termi-hint-{hint.id}">
          <TermiAvatar />
          <div
            class="max-w-[88%] rounded-2xl rounded-bl-md border border-base-300 bg-base-100 px-3.5 py-2.5 shadow-sm"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="text-sm font-bold">{copy.title}</div>
              <button
                type="button"
                data-testid="termi-hint-{hint.id}-dismiss"
                class="btn -mt-1 -mr-1.5 btn-circle text-base-content/40 btn-ghost btn-xs hover:text-base-content"
                aria-label={m.termi_hint_dismiss_aria()}
                title={m.termi_hint_dismiss_aria()}
                onclick={() => dismissHint(hint.id)}
              >
                <CloseIcon class_="h-3.5 w-3.5" />
              </button>
            </div>
            <div class="mt-1 text-[13px] leading-snug text-base-content/70">{copy.body}</div>
            {#if hint.status === 'done'}
              <div
                class="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-[13px] font-semibold text-success"
              >
                <CheckIcon class_="h-3.5 w-3.5" />
                {m.termi_hint_done_chip()}
              </div>
            {:else if hint.status === 'doing'}
              <div class="mt-2.5 flex items-center gap-2 text-[13px] text-base-content/60">
                <span class="termi-typing"><i></i><i></i><i></i></span>
                {copy.doing}
              </div>
            {:else if copy.action}
              <div class="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="termi-hint-{hint.id}-action"
                  class="btn btn-sm btn-primary"
                  onclick={() => runHint(hint.id)}
                >
                  {copy.action}
                </button>
                {#if copy.secondary}
                  <button
                    type="button"
                    data-testid="termi-hint-{hint.id}-secondary"
                    class="btn border border-base-300 text-base-content/70 btn-ghost btn-sm"
                    onclick={() => customizeHint(hint.id)}
                  >
                    {copy.secondary}
                  </button>
                {/if}
                {#if copy.link}
                  <button
                    type="button"
                    data-testid="termi-hint-{hint.id}-link"
                    class="btn px-0 btn-link btn-sm"
                    onclick={copy.link.onClick}
                  >
                    {copy.link.label}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}

      {#snippet bubble(/** @type {ChatMessage} */ msg)}
        <div class="flex items-end gap-2.5 {msg.role === 'user' ? 'justify-end' : ''}">
          {#if msg.role === 'bot'}
            <TermiAvatar />
          {/if}
          <div
            class="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line {msg.role ===
            'user'
              ? 'rounded-br-md bg-primary break-words text-primary-content'
              : 'rounded-bl-md border border-base-300 bg-base-200'}"
          >
            {#if msg.import && msg.importId}
              {@const id = msg.importId}
              {@const state = msg.import}
              {#if state.status === 'consent' || state.status === 'failed'}
                <div data-testid="termi-import-consent">
                  {state.quota === 'user'
                    ? m.termi_import_quota()
                    : state.quota === 'global'
                      ? m.termi_import_quota_global()
                      : state.quota === 'ineligible'
                        ? m.termi_import_not_eligible()
                        : state.status === 'failed'
                          ? m.termi_import_failed()
                          : m.termi_import_consent({ file: state.source, size: state.size })}
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  {#if !state.quota}
                    <button
                      type="button"
                      data-testid="termi-import-send"
                      class="btn btn-sm btn-primary"
                      onclick={() => sendImport(id)}
                    >
                      {m.termi_import_send()}
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    onclick={() => replaceImport(id, null)}
                  >
                    {m.termi_import_cancel()}
                  </button>
                </div>
              {:else if state.status === 'extracting'}
                <span class="termi-typing"><i></i><i></i><i></i></span>
              {:else}
                <ImportPreviewCard
                  {state}
                  onUpdate={(patch) => patchImport(id, patch)}
                  onPublish={() => publishImport(id)}
                  onRetry={() =>
                    publishImport(
                      id,
                      new Set([
                        ...(state.result?.failed.map((f) => f.key) ?? []),
                        ...(state.result?.skipped ?? [])
                      ])
                    )}
                  onStop={() => stoppedImports.add(id)}
                  onReextract={() => sendImport(id)}
                />
              {/if}
            {:else if msg.actions}
              <TermiAnswer text={msg.text} actions={msg.actions} />
            {:else}
              {msg.text}
            {/if}
            {#if msg.items || msg.sourcesUnavailable}
              <ItemCards
                items={msg.items}
                sourcesUnavailable={msg.sourcesUnavailable}
                query={msg.query}
                onRetry={msg.retry}
                onSearchAuthor={searchAuthor}
              />
            {/if}
            {#if msg.link}
              <a
                {...msg.link.attrs}
                data-testid="termi-help-link"
                class="btn mt-2 btn-sm btn-primary"
              >
                {msg.link.label}
              </a>
            {/if}
          </div>
        </div>
      {/snippet}

      {#each msgs as msg, i (i)}
        {@render bubble(msg)}
      {/each}

      {#if assistant}
        <!-- the first message is the question, already shown as the router bubble -->
        {#each assistant.chat.messages.slice(1).filter(visible) as msg (msg.id)}
          {#if msg.role === 'user'}
            <div class="flex items-end justify-end gap-2.5">
              <div
                class="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-line text-primary-content"
              >
                {textOf(msg)}
              </div>
            </div>
          {:else}
            <div class="flex items-end gap-2.5">
              <TermiAvatar />
              <div
                class="max-w-[88%] rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-2.5 text-sm leading-relaxed"
              >
                {#if textOf(msg)}
                  <div class="whitespace-pre-line">{textOf(msg)}</div>
                {:else if searchFailed(msg)}
                  {m.termi_search_failed()}
                  <div class="mt-2">
                    <a href={learningHref(chatQuery)} class="btn btn-sm btn-primary">
                      {m.termi_quota_link()}
                    </a>
                  </div>
                {:else if emptyAnswer(msg)}
                  {@const reply = fallbackReply(guessesFor(msg))}
                  <TermiAnswer text={reply.text} actions={reply.actions ?? []} />
                {/if}
                {#if pageActionsOf(msg).length > 0}
                  <TermiAnswer text="" actions={pageActionsOf(msg)} />
                {/if}
                {#each searchPartsOf(msg) as part (part.toolCallId)}
                  <ItemCards
                    items={part.output?.items ?? []}
                    sourcesUnavailable={part.output?.sourcesUnavailable ?? []}
                    query={String(part.input?.query ?? '')}
                    onRetry={msg.id === lastAssistantId
                      ? () => talk((chat) => chat.regenerate())
                      : undefined}
                    onSearchAuthor={searchAuthor}
                  />
                {/each}
                {#if !emptyAnswer(msg) && !lastStreaming(msg) && pageActionsOf(msg).length === 0 && guessesFor(msg, true).length > 0}
                  {@const guessed = guessActions(guessesFor(msg, true))}
                  {#if guessed.length > 0}
                    <div class="mt-2">
                      <TermiAnswer text={m.termi_route_maybe()} actions={guessed} />
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        {/each}

        {#if chatError && !chatBusy}
          <div class="flex items-end gap-2.5">
            <TermiAvatar />
            <div
              class="max-w-[82%] rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-2.5 text-sm leading-relaxed"
            >
              {#if chatError.status === 429}
                <!-- 'user' = today's own cap; anything else is the monthly global cap. -->
                {chatError.scope === 'user' ? m.termi_quota() : m.termi_quota_global()}
                <div class="mt-2">
                  <a href={learningHref(chatQuery)} class="btn btn-sm btn-primary">
                    {m.termi_quota_link()}
                  </a>
                </div>
              {:else}
                {m.termi_assistant_error()}
                <div class="mt-2 flex flex-wrap gap-2">
                  <a href={learningHref(chatQuery)} class="btn btn-ghost btn-sm">
                    {m.termi_quota_link()}
                  </a>
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    onclick={() => talk((chat) => chat.regenerate())}
                  >
                    {m.termi_assistant_retry()}
                  </button>
                </div>
              {/if}
              {#if rescue && rescue.sentence === chatSentence && rescue.items.some(keepItem)}
                <ItemCards
                  items={rescue.items}
                  sourcesUnavailable={rescue.sourcesUnavailable}
                  query={chatQuery}
                  onSearchAuthor={searchAuthor}
                />
              {/if}
            </div>
          </div>
        {/if}
      {/if}

      {#each imports as msg, i (i)}
        {@render bubble(msg)}
      {/each}

      {#if botTyping || (chatBusy && !visible(assistant?.chat.messages.at(-1) ?? { role: 'user', parts: [] }))}
        <div class="flex items-end gap-2.5">
          <TermiAvatar />
          <div class="rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-3">
            <span class="termi-typing"><i></i><i></i><i></i></span>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- beta notice: answers are canned without TERMI_AI_ENABLED -->
  {#if assistant}
    <p class="px-4 pb-1.5 text-center text-[11px] leading-snug text-base-content/50">
      {m.termi_ai_notice()}
    </p>
  {:else if !runtimeConfig.termi?.enabled}
    <p class="px-4 pb-1.5 text-center text-[11px] leading-snug text-base-content/50">
      {m.termi_static_notice()}
    </p>
  {/if}

  <!-- canned suggestions (router mode) / restart (assistant mode) -->
  <div class="flex flex-wrap gap-2 px-4 pb-2.5">
    {#if assistant}
      <button type="button" class="btn btn-ghost btn-sm" onclick={newConversation}>
        {m.termi_history_new()}
      </button>
    {/if}
    {#each assistant ? [] : suggestions as sugg (sugg.q)}
      <button
        type="button"
        class="rounded-full border border-base-300 bg-base-100 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
        onclick={() => ask(sugg.q)}
      >
        {sugg.q}
      </button>
    {/each}
  </div>

  <!-- input -->
  <form
    class="flex gap-2 border-t border-base-300 px-4 py-3"
    onsubmit={(e) => {
      e.preventDefault();
      ask(input);
    }}
  >
    <textarea
      rows="1"
      data-testid="termi-input"
      bind:this={composerEl}
      bind:value={input}
      placeholder={m.termi_input_placeholder()}
      aria-label={m.termi_input_aria()}
      oninput={growComposer}
      onkeydown={composerKeydown}
      class="textarea-bordered textarea max-h-40 min-h-10 w-full resize-none rounded-xl bg-base-200 textarea-sm leading-snug focus:bg-base-100"
    ></textarea>
    {#if runtimeConfig.termi?.llm}
      <input
        type="file"
        class="hidden"
        accept={IMPORT_ACCEPT}
        data-testid="termi-file-input"
        bind:this={fileInput}
        onchange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) receiveFile(file);
        }}
      />
      <button
        type="button"
        data-testid="termi-attach"
        class="btn h-10 w-10 rounded-xl p-0 text-base-content/70 btn-ghost"
        aria-label={m.termi_attach_aria()}
        title={m.termi_attach_aria()}
        onclick={() => fileInput?.click()}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          ><path
            d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
          /></svg
        >
      </button>
    {/if}
    <button
      type="submit"
      data-testid="termi-send"
      disabled={chatBusy}
      class="btn h-10 w-10 rounded-xl p-0 btn-primary"
      aria-label={m.termi_send_aria()}
    >
      <SendIcon class_="h-4 w-4" />
    </button>
  </form>
</div>

<style>
  /* Launcher slot: one step above the create FAB (which sits at
     bottom calc(4rem + safe-area + 0.75rem) on mobile, 1.5rem on lg). */
  .termi-slot {
    bottom: calc(3.5rem + env(safe-area-inset-bottom) + 0.75rem);
  }
  @media (min-width: 1024px) {
    .termi-slot {
      bottom: 5.75rem;
    }
  }

  .termi-pop-in {
    animation: termi-pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  @keyframes termi-pop {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .termi-panel-in {
    animation: termi-panel 0.25s ease-out;
  }
  @keyframes termi-panel {
    from {
      transform: translateX(40px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .termi-pop-in,
    .termi-panel-in {
      animation: none;
    }
  }

  .termi-typing {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    height: 10px;
  }
  .termi-typing i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--color-base-content) 60%, transparent);
    animation: termi-dot 1s infinite;
  }
  .termi-typing i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .termi-typing i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes termi-dot {
    0%,
    60%,
    100% {
      opacity: 0.3;
      transform: none;
    }
    30% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
</style>
