<script>
  // Termi chat window — popover (default) or side panel (expanded). Account
  // hints render as proactive bot messages with real actions; free-text input
  // is matched against canned suggestions; with TERMI_AI_ENABLED anything
  // else goes through the router (/api/termi, keyword fallback) for
  // navigate/create/help, and every other question to the content path.
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { CheckIcon, ClockIcon, CloseIcon, SendIcon } from '$lib/components/icons';
  import ConversationList from './history/ConversationList.svelte';
  import TermiAvatar from './TermiAvatar.svelte';
  import { copyFor } from './termi-hints-copy.js';
  import { createConversation } from './termi-conversation.svelte.js';
  import { createImportController, IMPORT_ACCEPT } from './import/import-controller.svelte.js';
  import { LESSON_PHASES, PHASE_LABELS } from '$lib/termi/lesson-state.js';
  import AnswerBubble from './AnswerBubble.svelte';
  import { getLocale } from '$lib/paraglide/runtime';
  import { untrack } from 'svelte';

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

  const conv = createConversation({
    getUser: getActiveUser,
    onRestart: () => imports.clearAttachment()
  });
  const imports = createImportController({
    conversation: conv,
    getUser: getActiveUser,
    onNeedsLogin: () => modalStore.openModal('login')
  });

  let input = $state('');
  let historyOpen = $state(false);
  /** @type {HTMLDivElement | undefined} */
  let bodyEl = $state(undefined);
  /** @type {HTMLTextAreaElement | undefined} */
  let composerEl;

  function resetComposerHeight() {
    if (composerEl) composerEl.style.height = '';
  }

  /** @param {KeyboardEvent} e */
  function composerKeydown(e) {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
    e.preventDefault();
    send(input);
  }

  /** @param {Event} e */
  function growComposer(e) {
    const el = /** @type {HTMLTextAreaElement} */ (e.target);
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 5 * lineHeight) + 'px';
  }

  /**
   * The composer's text (or a chip): with an attachment an import, else the conversation's.
   * An option click is never the attachment's instruction: the chip waits for her own Send.
   * @param {string} q @param {{ fromOption?: boolean }} [opts]
   */
  function send(q, { fromOption = false } = {}) {
    if (imports.attachment && !conv.botTyping && !fromOption) {
      sendAttachment(q);
      return;
    }
    if (!q.trim() || conv.botTyping) return;
    historyOpen = false;
    if (conv.ask(q)) {
      input = '';
      resetComposerHeight();
    }
  }
  /** @param {import('$lib/termi/items.d.js').Item} person */
  const searchAuthor = (person) => conv.searchAuthor(person, send);

  $effect(() => () => {
    imports.dispose();
    conv.dispose();
  });

  // An account switch ends the chat: it was signed, and gated, as the old account.
  $effect(() => {
    const pubkey = getActiveUser()?.pubkey;
    void conv.assistant;
    untrack(() => conv.syncAccount(pubkey));
  });

  // A finished tier-2 answer (streaming → ready) is recorded.
  $effect(() => {
    const status = conv.assistant?.chat.status;
    untrack(() => conv.observeChatStatus(status));
  });

  // Conversation history (flag on): one store per account, recreated on a switch.
  const historyScope = $derived(getActiveUser()?.pubkey ?? 'anon');
  $effect(() => {
    if (!runtimeConfig.termi?.enabled) return;
    const scope = historyScope;
    const close = untrack(() => conv.connectHistory(scope, getActiveUser()));
    return () => {
      close();
      historyOpen = false;
    };
  });

  /** @param {string} id */
  async function openConversation(id) {
    if (await conv.openConversation(id)) historyOpen = false;
  }

  function newConversation() {
    conv.newConversation();
    historyOpen = false;
  }

  function toggleHistory() {
    historyOpen = !historyOpen;
    if (historyOpen) conv.history?.refresh();
  }

  // File import (the pipeline is the import controller's): chip, paperclip and drop overlay.
  let dragging = $state(false);
  /** @type {HTMLInputElement | undefined} */
  let fileInput = $state();
  /** @param {File} file */
  function receiveFile(file) {
    historyOpen = false;
    imports.receiveFile(file);
  }
  /**
   * In task `lesson` this resolves once the extraction settles (success or a
   * read failure), so the composer text is only cleared on success.
   * @param {string} q
   */
  async function sendAttachment(q) {
    if (!(await imports.sendAttachment(q))) return;
    input = '';
    resetComposerHeight();
    historyOpen = false;
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
  // The conversation, projected once per change (the Chat's messages and status are reactive).
  const turns = $derived(conv.turns);
  // One reactive read of the locale, reused below instead of a second getLocale() call.
  const locale = $derived(getLocale());
  // Mode-as-contract header (task lesson): phase 1 even before the model's first lesson_state.
  const lessonPhase = $derived(conv.lessonState?.phase ?? 1);
  const lessonLabels = $derived(locale === 'de' ? PHASE_LABELS.de : PHASE_LABELS.en);
  const typing = $derived(
    conv.botTyping ||
      (conv.chatBusy &&
        !conv.visible(conv.assistant?.chat.messages.at(-1) ?? { role: 'user', parts: [] }))
  );
  // An answer action's yes/no question (the LiaScript preview warning), in the app's modal grammar.
  let confirmAsk = $state.raw(
    /** @type {{ text: string, resolve: (ok: boolean) => void } | null} */ (null)
  );
  /** @param {boolean} ok */
  function answerConfirm(ok) {
    confirmAsk?.resolve(ok);
    confirmAsk = null;
  }

  const bubbleCtx = {
    retryOf: conv.retryOf,
    regenerate: () => conv.talk((chat) => chat.regenerate()),
    onSearchAuthor: searchAuthor,
    // an option click is a typed message: the composer path, history and consent as usual
    send: (/** @type {string} */ text) => send(text, { fromOption: true }),
    canPick: conv.canPick,
    /** @type {import('./answer-actions.js').AnswerActionCtx} */
    actionCtx: {
      get user() {
        return getActiveUser();
      },
      get locale() {
        return locale;
      },
      get author() {
        const profile = getProfile();
        return profile?.display_name || profile?.name;
      },
      close: () => onClose(),
      getState: conv.actionStateOf,
      setState: conv.setActionState,
      setArtifacts: conv.setArtifacts,
      get task() {
        return conv.task;
      },
      confirm: (/** @type {string} */ text) =>
        new Promise((resolve) => {
          confirmAsk?.resolve(false); // a second question replaces an open one
          confirmAsk = { text, resolve };
        }),
      conversationId: conv.conversationId,
      recordPartWrap: conv.recordPartWrap,
      replaceTurnText: conv.replaceTurnText
    },
    importActions: {
      reextract: imports.reextract,
      publish: imports.publish,
      retry: imports.retry,
      update: conv.patchImport,
      stop: imports.stop
    }
  };

  $effect(() => {
    void turns;
    void typing;
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
    {#if conv.history}
      <button
        type="button"
        data-testid="termi-history-toggle"
        class="btn btn-circle text-base-content/60 btn-ghost btn-sm"
        aria-label={m.termi_history_aria()}
        aria-pressed={historyOpen}
        title={m.termi_history_aria()}
        onclick={toggleHistory}
      >
        <ClockIcon class_="h-4 w-4" title="" />
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

  <!-- mode-as-contract header: persistent while task is lesson, never only at entry -->
  {#if conv.task === 'lesson'}
    <div
      data-testid="termi-lesson-header"
      class="flex flex-col gap-1.5 border-b border-base-300 bg-base-100 px-4 py-2"
    >
      <div class="text-xs font-semibold text-base-content/70">
        {m.termi_lesson_mode_header({ n: lessonPhase, name: lessonLabels[lessonPhase - 1] })}
      </div>
      <div class="flex gap-1">
        {#each LESSON_PHASES as key, i (key)}
          {@const state = i + 1 < lessonPhase ? 'done' : i + 1 === lessonPhase ? 'current' : 'next'}
          <span
            data-testid="termi-lesson-phase"
            data-state={state}
            title={lessonLabels[i]}
            class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold {state ===
            'current'
              ? 'bg-primary text-primary-content'
              : state === 'done'
                ? 'bg-primary/20 text-primary'
                : 'bg-base-200 text-base-content/40'}"
          >
            {state === 'done' ? '✓' : i + 1}
          </span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- messages, or the history list in their place -->
  {#if historyOpen && conv.history}
    <ConversationList
      conversations={conv.history.list}
      currentId={conv.history.current?.id}
      onOpen={openConversation}
      onNew={newConversation}
      onRemove={conv.removeConversation}
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
        {@const copy = copyFor(hint, { isNsec })}
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

      {#each turns as turn (turn.id)}
        <AnswerBubble {turn} ctx={bubbleCtx} />
      {/each}

      {#if typing}
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
  {#if conv.assistant}
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
    {#if conv.assistant}
      <button type="button" class="btn btn-ghost btn-sm" onclick={newConversation}>
        {m.termi_history_new()}
      </button>
    {/if}
    {#each conv.assistant ? [] : conv.suggestions as sugg (sugg.q)}
      <button
        type="button"
        class="rounded-full border border-base-300 bg-base-100 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
        onclick={() => send(sugg.q)}
      >
        {sugg.q}
      </button>
    {/each}
  </div>

  <!-- input -->
  <form
    class="border-t border-base-300 px-4 py-3"
    onsubmit={(e) => {
      e.preventDefault();
      send(input);
    }}
  >
    {#if imports.attachment}
      {@const attachment = imports.attachment}
      <div
        data-testid="termi-attachment"
        class="mb-2 flex items-start gap-2 rounded-xl border border-base-300 bg-base-200 px-3 py-2 text-xs"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold">
            {attachment.file.name}
            <span class="font-normal text-base-content/60">({attachment.size})</span>
          </div>
          <div class="text-base-content/70">
            {conv.task === 'lesson' ? m.termi_lesson_attach_hint() : m.termi_import_chip_hint()}
          </div>
        </div>
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-xs"
          aria-label={m.termi_import_chip_remove()}
          title={m.termi_import_chip_remove()}
          onclick={imports.clearAttachment}
        >
          <CloseIcon class_="h-3 w-3" title="" />
        </button>
      </div>
    {/if}
    <div class="flex gap-2">
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
        disabled={conv.chatBusy}
        class="btn h-10 w-10 rounded-xl p-0 btn-primary"
        aria-label={m.termi_send_aria()}
      >
        <SendIcon class_="h-4 w-4" />
      </button>
    </div>
  </form>
  {#if confirmAsk}
    <div class="modal-open modal" data-testid="termi-confirm">
      <div class="modal-box max-w-sm">
        <p class="text-sm">{confirmAsk.text}</p>
        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            data-testid="termi-confirm-cancel"
            onclick={() => answerConfirm(false)}>{m.common_cancel()}</button
          >
          <button
            type="button"
            class="btn btn-primary"
            data-testid="termi-confirm-ok"
            onclick={() => answerConfirm(true)}>{m.termi_confirm_continue()}</button
          >
        </div>
      </div>
    </div>
  {/if}
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

  /* AnswerBubble's import card shows the same dots: global, but only inside this window */
  [data-testid='termi-window'] :global(.termi-typing) {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    height: 10px;
  }
  [data-testid='termi-window'] :global(.termi-typing i) {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in oklab, var(--color-base-content) 60%, transparent);
    animation: termi-dot 1s infinite;
  }
  [data-testid='termi-window'] :global(.termi-typing i:nth-child(2)) {
    animation-delay: 0.15s;
  }
  [data-testid='termi-window'] :global(.termi-typing i:nth-child(3)) {
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
