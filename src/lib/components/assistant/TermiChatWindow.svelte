<script>
  // Termi chat window — popover (default) or side panel (expanded). Account
  // hints render as proactive bot messages with real actions; free-text input
  // is matched against canned suggestions (no LLM backend yet).
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { matchSuggestion } from '$lib/helpers/assistant-hints.js';
  import { CheckIcon, CloseIcon, SendIcon } from '$lib/components/icons';
  import TermiAvatar from './TermiAvatar.svelte';

  /**
   * @type {{
   *   expanded?: boolean,
   *   onToggleExpand: () => void,
   *   onClose: () => void,
   *   hints: Array<{id: string, status: string}>,
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
      doing: null
    },
    relays: {
      title: m.relay_list_banner_title(),
      body: isNsec ? m.relay_list_banner_body_nsec() : m.relay_list_banner_body(),
      action: m.relay_list_banner_use_cta(),
      secondary: m.relay_list_banner_customize_cta(),
      doing: m.termi_hint_relays_doing()
    },
    dm: {
      title: m.dm_relay_banner_title(),
      body: m.dm_relay_banner_body(),
      action: m.dm_relay_banner_use_cta(),
      secondary: m.dm_relay_banner_customize_cta(),
      doing: m.termi_hint_dm_doing()
    },
    nip05: {
      title: m.termi_hint_nip05_title(),
      body: m.termi_hint_nip05_body({
        domain: `@${runtimeConfig.membership?.handleDomain || ''}`
      }),
      action: m.termi_hint_nip05_cta(),
      secondary: null,
      doing: null
    },
    profile: {
      title: m.termi_hint_profile_title(),
      body: m.termi_hint_profile_body(),
      action: m.termi_hint_profile_cta(),
      secondary: null,
      doing: null
    },
    invites: {
      title: m.concord_invite_hint_title(),
      body: m.concord_invite_hint_body(),
      action: m.concord_invite_hint_action(),
      secondary: null,
      doing: null
    }
  });

  const suggestions = $derived([
    { q: m.termi_sugg_1_q(), a: m.termi_sugg_1_a() },
    { q: m.termi_sugg_2_q(), a: m.termi_sugg_2_a() },
    { q: m.termi_sugg_3_q(), a: m.termi_sugg_3_a() }
  ]);

  /** @type {Array<{role: 'user' | 'bot', text: string}>} */
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
    const match = matchSuggestion(q, suggestions);
    msgs = [...msgs, { role: 'user', text: q.trim() }];
    input = '';
    botTyping = true;
    replyTimer = setTimeout(() => {
      botTyping = false;
      msgs = [...msgs, { role: 'bot', text: match ? match.a : m.termi_fallback() }];
    }, 900);
  }

  $effect(() => () => clearTimeout(replyTimer));

  // Keep the newest message in view. Read the reactive deps before touching
  // the DOM so the effect re-runs on every change.
  $effect(() => {
    void msgs;
    void botTyping;
    void hints;
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
  <div bind:this={bodyEl} class="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
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
      {@const copy =
        hintCopy[
          /** @type {'backup' | 'relays' | 'dm' | 'nip05' | 'profile' | 'invites'} */ (hint.id)
        ]}
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
          {:else}
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
          {msg.text}
        </div>
      </div>
    {/each}

    {#if botTyping}
      <div class="flex items-end gap-2.5">
        <TermiAvatar />
        <div class="rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-3">
          <span class="termi-typing"><i></i><i></i><i></i></span>
        </div>
      </div>
    {/if}
  </div>

  <!-- beta notice: answers are canned until the AI backend lands -->
  <p class="px-4 pb-1.5 text-center text-[11px] leading-snug text-base-content/50">
    {m.termi_static_notice()}
  </p>

  <!-- canned suggestions -->
  <div class="flex flex-wrap gap-2 px-4 pb-2.5">
    {#each suggestions as sugg (sugg.q)}
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
    bottom: calc(4rem + env(safe-area-inset-bottom) + 0.75rem + 4.25rem);
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
