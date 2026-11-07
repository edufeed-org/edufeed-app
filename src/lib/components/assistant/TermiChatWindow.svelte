<script>
  // Termi chat window — popover (default) or side panel (expanded). Account
  // hints render as proactive bot messages with real actions; free-text input
  // is matched against canned suggestions; with TERMI_AI_ENABLED anything
  // else goes through the router (/api/termi, keyword fallback).
  import { getFirstPendingInvite } from '$lib/concord/pending-invites.svelte.js';
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { helpLinkAttrs } from '$lib/helpers/help-link.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { matchSuggestion } from '$lib/helpers/assistant-hints.js';
  import { CheckIcon, CloseIcon, SendIcon } from '$lib/components/icons';
  import TermiAvatar from './TermiAvatar.svelte';
  import TermiAnswer from './TermiAnswer.svelte';
  import TermiSearchHits from './TermiSearchHits.svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { getLocale } from '$lib/paraglide/runtime';
  import { TERMI_SKILLS, learningSearchSkill, extractQuery } from '$lib/helpers/termi-skills.js';
  import { runCreateAction } from '$lib/helpers/run-create-action.js';
  import { routeQuestion, skillAction, answerableSkill, helpAnswer } from './termi-router.js';

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
  /** @typedef {{role: 'user' | 'bot', text: string, link?: Suggestion['link'], actions?: TermiAction[]}} ChatMessage */

  /** @type {ChatMessage[]} */
  let msgs = $state.raw([]);
  let input = $state('');
  let botTyping = $state(false);
  /** @type {HTMLDivElement | undefined} */
  let bodyEl = $state(undefined);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let replyTimer;

  /** @param {string} q */
  function ask(q) {
    if (!q.trim() || botTyping) return;
    if (assistant) {
      if (chatBusy) return;
      input = '';
      talk((chat) => chat.sendMessage({ text: q.trim() }));
      return;
    }
    const match = matchSuggestion(q, suggestions);
    msgs = [...msgs, { role: 'user', text: q.trim() }];
    input = '';
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

  // Assistant mode: an AI chat (/api/termi/chat), started by a confident
  // `assistant.search` decision. Memory only; the window owns it.
  /** @typedef {{ chat: import('@ai-sdk/svelte').Chat, reset: () => void }} TermiAssistantChat */
  let assistant = $state.raw(/** @type {TermiAssistantChat | null} */ (null));
  const chatBusy = $derived(
    !!assistant && (assistant.chat.status === 'submitted' || assistant.chat.status === 'streaming')
  );
  const chatError = $derived(
    /** @type {(Error & { status?: number }) | undefined} */ (assistant?.chat.error)
  );
  /** @param {any} msg */
  const textOf = (msg) =>
    msg.parts
      .filter((/** @type {any} */ p) => p.type === 'text')
      .map((/** @type {any} */ p) => p.text)
      .join('')
      .trim(); // some models (qwen) lead with blank lines
  // Both tool-part shapes: `tool-<name>` and `dynamic-tool` with `toolName`.
  /** @param {any} msg */
  const searchPartsOf = (msg) =>
    msg.parts.filter(
      (/** @type {any} */ p) =>
        (p.type === 'tool-search_resources' ||
          (p.type === 'dynamic-tool' && p.toolName === 'search_resources')) &&
        p.state === 'output-available'
    );
  // A failed search with no model text to explain it gets a note of its own.
  /** @param {any} msg */
  const searchFailed = (msg) =>
    msg.role === 'assistant' &&
    !textOf(msg) &&
    msg.parts.some(
      (/** @type {any} */ p) =>
        (p.type === 'tool-search_resources' ||
          (p.type === 'dynamic-tool' && p.toolName === 'search_resources')) &&
        p.state === 'output-error'
    ) &&
    !(chatBusy && assistant?.chat.messages.at(-1)?.id === msg.id);
  /** @param {any} msg */
  const visible = (msg) =>
    msg.role === 'user' || !!textOf(msg) || searchPartsOf(msg).length > 0 || searchFailed(msg);
  const chatQuery = $derived.by(() => {
    const lastUser = assistant?.chat.messages.findLast((x) => x.role === 'user');
    return lastUser ? extractQuery(textOf(lastUser), getLocale() === 'en' ? 'en' : 'de') : '';
  });
  const learningHref = (/** @type {string} */ q) =>
    q ? `/discover?type=learning&search=${encodeURIComponent(q)}` : '/discover?type=learning';

  /** @param {string} text the user's question, already shown as the router bubble */
  async function startAssistant(text) {
    const user = getActiveUser();
    const { createTermiChat } = await import('./termi-chat.svelte.js');
    if (destroyed) return;
    assistant = createTermiChat({
      task: 'search',
      user: /** @type {any} */ (user)
    });
    botTyping = false;
    await talk((chat) => chat.sendMessage({ text }));
  }

  /** @param {(chat: import('@ai-sdk/svelte').Chat) => Promise<void>} run */
  async function talk(run) {
    const current = assistant;
    if (!current) return;
    await run(current.chat);
    // 503: LLM or nope-mcp not configured — back to the router with the plain search.
    if (current === assistant && chatError?.status === 503) {
      const q = chatQuery;
      leaveAssistant();
      msgs = [
        ...msgs,
        {
          role: 'bot',
          text: m.termi_assistant_unavailable(),
          actions: [{ label: m.termi_quota_link(), href: learningHref(q) }]
        }
      ];
    }
  }

  function leaveAssistant() {
    assistant?.reset();
    assistant = null;
  }

  function restart() {
    leaveAssistant();
    msgs = [];
  }

  /** @param {string} text */
  async function routeAnswer(text) {
    /** @type {ChatMessage} */
    let reply;
    try {
      const user = getActiveUser();
      const { decision, query, available } = await routeQuestion(text, {
        locale: getLocale() === 'en' ? 'en' : 'de',
        fetch,
        // help.3 points at the guide: like its chip, only offered with a HELP_URL.
        skills: helpLink ? TERMI_SKILLS : TERMI_SKILLS.filter((s) => s.id !== 'help.3'),
        ctx: {
          loggedIn: !!user,
          discoverTypes: runtimeConfig.discover?.contentTypes ?? [],
          llm: !!runtimeConfig.termi?.llm
        }
      });
      if (decision.kind === 'confident' && decision.skill === 'assistant.search') {
        // availableSkills offers it only with the LLM on and someone logged in.
        await startAssistant(text);
        return;
      }
      reply = routerReply(decision, query, available, user?.pubkey);
    } catch {
      reply = { role: 'bot', text: m.termi_fallback() };
    }
    botTyping = false;
    msgs = [...msgs, reply];
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
   * @param {ReturnType<typeof import('$lib/helpers/termi-skills.js').decide>} decision
   * @param {string} query
   * @param {import('$lib/helpers/termi-skills.js').TermiSkill[]} available
   * @param {string | undefined} pubkey
   * @returns {ChatMessage}
   */
  function routerReply(decision, query, available, pubkey) {
    const ctx = {
      query,
      npub: pubkey ? nip19.npubEncode(pubkey) : null,
      runCreate: (/** @type {import('$lib/config/create-actions.js').CreateAction} */ action) =>
        runCreateAction(action, { goto, resolve: (path) => resolve(/** @type {any} */ (path)) }),
      runHelp: (/** @type {import('$lib/helpers/termi-skills.js').TermiSkill} */ skill) => {
        msgs = [...msgs, helpReply(skill)];
      }
    };
    /** @param {string} id */
    const skillOf = (id) => available.find((s) => s.id === answerableSkill(id));
    /** @param {string} id @param {string} [q] */
    const actionOf = (id, q = query) => {
      const skill = skillOf(id);
      return skill ? skillAction(skill, { ...ctx, query: q }) : null;
    };
    /** @param {Array<TermiAction | null>} list @returns {TermiAction[]} */
    const present = (list) => /** @type {TermiAction[]} */ (list.filter(Boolean));

    if (decision.kind === 'confident') {
      const skill = skillOf(decision.skill);
      if (skill?.kind === 'help') return helpReply(skill);
      const action = actionOf(decision.skill);
      if (action) return { role: 'bot', text: m.termi_route_go(), actions: [action] };
    }
    if (decision.kind === 'maybe') {
      const ids = [...new Set(decision.skills.map(answerableSkill))];
      const actions = present(ids.map((id) => actionOf(id)));
      if (actions.length) return { role: 'bot', text: m.termi_route_maybe(), actions };
    }
    return {
      role: 'bot',
      text: `${m.termi_fallback()} ${m.termi_route_fallback_actions()}`,
      actions: present([
        actionOf('home'),
        // Unrecognised text is no search query: offer the plain search page.
        actionOf(learningSearchSkill(available), ''),
        helpLink ? { label: m.termi_sugg_4_link(), ...helpLink } : actionOf('help.1')
      ])
    };
  }

  // Keep the newest message in view. Read the reactive deps before touching
  // the DOM so the effect re-runs on every change.
  $effect(() => {
    void msgs;
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
  class="fixed z-[70] flex flex-col overflow-hidden bg-base-100 shadow-2xl {expanded
    ? 'termi-panel-in inset-y-0 right-0 w-[min(420px,100vw)] border-l border-base-300'
    : 'termi-pop-in termi-slot right-4 h-[min(600px,calc(100dvh-10rem))] w-[min(400px,calc(100vw-2rem))] rounded-2xl border border-base-300 lg:right-6'}"
>
  <!-- header -->
  <div class="flex items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-3">
    <TermiAvatar size={34} />
    <div class="min-w-0 flex-1">
      <div class="text-[15px] leading-tight font-bold">Termi</div>
      <div class="text-xs leading-tight text-base-content/60">{m.termi_header_sub()}</div>
    </div>
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

  <!-- messages -->
  <div
    bind:this={bodyEl}
    role="log"
    aria-live="polite"
    class="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
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

    {#each msgs as msg, i (i)}
      <div class="flex items-end gap-2.5 {msg.role === 'user' ? 'justify-end' : ''}">
        {#if msg.role === 'bot'}
          <TermiAvatar />
        {/if}
        <div
          class="max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed {msg.role === 'user'
            ? 'rounded-br-md bg-primary text-primary-content'
            : 'rounded-bl-md border border-base-300 bg-base-200'}"
        >
          {#if msg.actions}
            <TermiAnswer text={msg.text} actions={msg.actions} />
          {:else}
            {msg.text}
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
    {/each}

    {#if assistant}
      <!-- the first message is the question, already shown as the router bubble -->
      {#each assistant.chat.messages.slice(1).filter(visible) as msg (msg.id)}
        {#if msg.role === 'user'}
          <div class="flex items-end justify-end gap-2.5">
            <div
              class="max-w-[82%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line text-primary-content"
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
              {#each searchPartsOf(msg) as part (part.toolCallId)}
                <TermiSearchHits
                  hits={part.output?.hits ?? []}
                  query={String(part.input?.query ?? chatQuery)}
                />
              {/each}
              {#if textOf(msg)}
                <div class="whitespace-pre-line">{textOf(msg)}</div>
              {:else if searchFailed(msg)}
                {m.termi_search_failed()}
                <div class="mt-2">
                  <a href={learningHref(chatQuery)} class="btn btn-sm btn-primary">
                    {m.termi_quota_link()}
                  </a>
                </div>
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
              {m.termi_quota()}
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
          </div>
        </div>
      {/if}
    {/if}

    {#if botTyping || (chatBusy && !visible(assistant?.chat.messages.at(-1) ?? { role: 'user', parts: [] }))}
      <div class="flex items-end gap-2.5">
        <TermiAvatar />
        <div class="rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-3">
          <span class="termi-typing"><i></i><i></i><i></i></span>
        </div>
      </div>
    {/if}
  </div>

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
      <button type="button" class="btn btn-ghost btn-sm" onclick={restart}>
        {m.termi_assistant_restart()}
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
    <input
      data-testid="termi-input"
      bind:value={input}
      placeholder={m.termi_input_placeholder()}
      aria-label={m.termi_input_aria()}
      class="input-bordered input input-sm h-10 min-w-0 flex-1 rounded-xl bg-base-200 focus:bg-base-100"
    />
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
