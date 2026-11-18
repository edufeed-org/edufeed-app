<script>
  // Termi chat window — popover (default), side panel (expanded) or the full-screen
  // Werkbank (a draft's rail and document beside the chat). Account
  // hints render as proactive bot messages with real actions; free-text input
  // is matched against canned suggestions; with TERMI_AI_ENABLED anything
  // else goes through the router (/api/termi, keyword fallback) for
  // navigate/create/help, and every other question to the content path.
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { CheckIcon, ClockIcon, CloseIcon, SendIcon, StopIcon } from '$lib/components/icons';
  import ConversationList from './history/ConversationList.svelte';
  import TermiAvatar from './TermiAvatar.svelte';
  import { copyFor } from './termi-hints-copy.js';
  import CapabilityCards from './CapabilityCards.svelte';
  import { useTermiCapabilities } from './termi-capabilities.svelte.js';
  import { createConversation } from './termi-conversation.svelte.js';
  import { createImportController, IMPORT_ACCEPT } from './import/import-controller.svelte.js';
  import { LESSON_PHASES, PHASE_LABELS, partKey } from '$lib/termi/lesson-state.js';
  import { allowedLinks, linkKit, onLinkClick } from '$lib/termi/links.js';
  import {
    ANSWER_ACTIONS,
    loadTurnDrafts,
    runAnswerAction,
    saveLessonParts
  } from './answer-actions.js';
  import {
    activityOf,
    createRun,
    foundCompetences,
    nextPartKey,
    partLines,
    partsOf,
    plannedKeys,
    railRows
  } from '$lib/termi/werkbank.js';
  import { partTitle } from './werkbank/part-title.js';
  import {
    chosenModel,
    isOutside,
    modelLabel,
    namesOf,
    nextCandidate
  } from '$lib/termi/model-choice.js';
  import { WAIT_NOTICE_MS } from '$lib/termi/wait.js';
  import WaitCard from './WaitCard.svelte';
  import { serviceOf } from '$lib/termi/model-id.js';
  import AnswerBubble from './AnswerBubble.svelte';
  import BottomSheet from '$lib/components/shared/BottomSheet.svelte';
  import { getLocale } from '$lib/paraglide/runtime';
  import { tick, untrack } from 'svelte';

  /** Without a first token for this long, the dots get a "taking longer" line. */
  const SLOW_AFTER_MS = 15_000;
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';

  /**
   * @type {{
   *   expanded?: boolean,
   *   onToggleExpand: () => void,
   *   workbench?: boolean,
   *   onWorkbench?: (open: boolean) => void,
   *   pendingId?: string | null,
   *   onPendingHandled?: () => void,
   *   pendingStart?: 'material' | 'lesson' | 'import' | null,
   *   onStartHandled?: () => void,
   *   resumeId?: string | null,
   *   resumeWorkbench?: boolean,
   *   onConversation?: (id: string | null) => void,
   *   onClose: () => void,
   *   hints: Array<{id: string, status: string, variant?: string, address?: string, count?: number, relay?: string, replacement?: string | null, days?: number}>,
   *   openCount: number,
   *   runHint: (id: any) => void,
   *   customizeHint: (id: any) => void,
   *   dismissHint: (id: any) => void,
   *   host?: import('$lib/termi/host.js').TermiHost
   * }}
   */
  let {
    expanded = false,
    onToggleExpand,
    workbench = false,
    onWorkbench,
    pendingId = null,
    onPendingHandled,
    pendingStart = null,
    onStartHandled,
    resumeId: resumeIdProp = null,
    resumeWorkbench = false,
    onConversation,
    onClose,
    hints,
    openCount,
    runHint,
    customizeHint,
    dismissHint,
    host
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
    onConversation: (id) => onConversation?.(id),
    // the old conversation's modal and open question end with it: nothing signs into the new one
    onRestart: () => {
      imports.clearAttachment();
      publishOpen = false;
      answerConfirm(false);
      // a run of the old conversation ends with it (its pending write fails on the id check)
      run = null;
      runState = {};
      queued = [];
      waitingMsg = null;
    }
  });
  const imports = createImportController({
    conversation: conv,
    getUser: getActiveUser,
    onNeedsLogin: () => modalStore.openModal('login')
  });

  let input = $state('');
  // The Werkbank run (see startRun): one button writes every planned part in a row.
  /** @type {ReturnType<typeof createRun> | null} */
  let run = null;
  let runState = $state.raw(
    /** @type {{ writing?: string, failed?: string, paused?: true, done?: true }} */ ({})
  );
  let queued = $state.raw(/** @type {string[]} */ ([]));
  // Outside a run: ONE message typed while an answer runs; it goes out once the chat is idle,
  // and only into the conversation it was typed in (`gen`: the controller's generation then).
  let waitingMsg = $state.raw(/** @type {{ text: string, gen: number } | null} */ (null));
  let pausing = $state(false);
  let windowGone = false;
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
    // a run is writing: her message waits for the part in progress
    if (runState.writing && run) {
      if (!q.trim()) return;
      run.queue(q.trim());
      queued = [...queued, q.trim()];
      if (!fromOption) {
        input = '';
        resetComposerHeight();
      }
      return;
    }
    // an answer runs: her message waits (a second one replaces it)
    if (conv.chatBusy && !imports.attachment) {
      if (!q.trim()) return;
      waitingMsg = { text: q.trim(), gen: conv.generation };
      if (!fromOption) {
        input = '';
        resetComposerHeight();
      }
      return;
    }
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
  // the waiting message goes out once the chat is idle (a run drains its own queue first)
  // another conversation is shown (opened, new, account switch): her message belonged to the old one
  $effect(() => {
    const gen = conv.generation;
    if (untrack(() => waitingMsg && waitingMsg.gen !== gen)) waitingMsg = null;
  });
  $effect(() => {
    const w = waitingMsg;
    if (!w || conv.chatBusy || conv.botTyping || runState.writing) return;
    untrack(() => {
      waitingMsg = null;
      if (w.gen !== conv.generation) return;
      if (!conv.ask(w.text)) input = [input, w.text].filter(Boolean).join('\n\n');
    });
  });
  function takeBack() {
    input = [input, waitingMsg?.text].filter(Boolean).join('\n\n');
    waitingMsg = null;
  }
  /** Stop the running answer; what waited is dropped, a run pauses after its part. */
  function stopAnswer() {
    waitingMsg = null;
    if (run) pauseRun();
    void conv.stop();
  }
  /** @param {import('$lib/termi/items.d.js').Item} person */
  const searchAuthor = (person) => conv.searchAuthor(person, send);

  $effect(() => () => {
    windowGone = true;
    imports.dispose();
    conv.dispose();
  });

  // An account switch ends the chat: it was signed, and gated, as the old account.
  $effect(() => {
    const pubkey = getActiveUser()?.pubkey;
    void conv.assistant;
    untrack(() => conv.syncAccount(pubkey));
  });

  // The open SAIA list on open and per account: the model button before the first question, unsigned.
  $effect(() => {
    void getActiveUser()?.pubkey;
    untrack(() => void conv.loadOpenModels());
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
  async function openConversation(id, enter = true, ifEmpty = false) {
    if (!(await conv.openConversation(id, { ifEmpty }))) return false;
    historyOpen = false;
    // the effect below enters once per conversation: an explicit open always enters
    await tick();
    if (draftOpen && enter) onWorkbench?.(true);
    return true;
  }

  // A draft asked for from outside (?termi=<id>): open it once the history store is there.
  // An unknown id opens nothing, so the window stays as it is — never an empty Werkbank.
  $effect(() => {
    const id = pendingId;
    if (!id) return;
    let stale = false;
    void conv.historyReady.then(() => {
      if (stale) return;
      onPendingHandled?.();
      return openConversation(id);
    });
    return () => (stale = true);
  });

  // The conversation this window showed before it was closed (same page session; a reload
  // forgets it): it comes back, unless a draft is asked for. The Werkbank only if it was open then.
  const resumeId = untrack(() => (pendingId ? null : resumeIdProp));
  $effect(() => {
    const id = resumeId;
    if (!id) return;
    if (!resumeWorkbench) workbenchClosed.add(id);
    let stale = false;
    void conv.historyReady
      .then(() => !stale && openConversation(id, resumeWorkbench, true))
      .then((opened) => {
        // a store that does not hold it (deleted, other account): forget it. Not when the user was quicker.
        if (opened === false && !stale && !conv.turns.length && !conv.assistant)
          onConversation?.(null);
      });
    return () => (stale = true);
  });

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

  // The empty chat's capability cards: each starts the real thing.
  const capabilities = useTermiCapabilities(getActiveUser);
  /** @param {import('$lib/termi/capabilities.js').CapabilityCard} card */
  function pickCapability(card) {
    if (card.id === 'material') {
      input = m.termi_cap_material_prefill();
      composerEl?.focus();
    } else if (card.id === 'lesson') send(m.termi_cap_lesson_q());
    else if (card.id === 'import') fileInput?.click();
    else if ('locked' in card)
      modalStore.openModal(card.locked === 'login' ? 'login' : 'membershipApply');
  }
  // the tour's "try it now": effects run after mount, so the composer and the file input exist
  $effect(() => {
    const id = pendingStart;
    if (!id) return;
    untrack(() => {
      onStartHandled?.();
      pickCapability({ id });
    });
  });
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

  // The conversation, projected once per change (the Chat's messages and status are reactive).
  const turns = $derived(conv.turns);
  // One reactive read of the locale, reused below instead of a second getLocale() call.
  const locale = $derived(getLocale());
  // Mode-as-contract header (task lesson): phase 1 even before the model's first lesson_state.
  const lessonPhase = $derived(conv.lessonState?.phase ?? 1);
  const lessonLabels = $derived(locale === 'de' ? PHASE_LABELS.de : PHASE_LABELS.en);
  // Dots from send until the answer shows something: a busy chat whose last
  // message is still the user's own (no token yet — up to the route's 180 s on
  // a slow provider day, laoc 2026-11-11) or an assistant message with nothing
  // visible yet.
  const typing = $derived.by(() => {
    if (conv.botTyping) return true;
    if (!conv.chatBusy) return false;
    const last = conv.assistant?.chat.messages.at(-1);
    return !last || last.role !== 'assistant' || !conv.visible(last);
  });
  // After a while without a token, say so under the dots.
  let slow = $state(false);
  $effect(() => {
    if (!typing) {
      slow = false;
      return;
    }
    const t = setTimeout(() => (slow = true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  });
  // Models: the menu loads with the button; names and the chosen id label the bubbles and notices.
  const modelButton = lazyComponent(() => import('./ModelButton.svelte'));
  const modelNames = $derived(namesOf(conv.models));
  const chosen = $derived(
    conv.models ? chosenModel(conv.choice, conv.models, conv.outsideOk) : null
  );
  // A divider before an answer whose service differs from the previous answer's (render-time only).
  const DIVIDER = {
    saia: m.termi_model_divider_saia,
    anthropic: m.termi_model_divider_outside
  };
  const dividers = $derived.by(() => {
    /** @type {Record<string, string>} */
    const out = {};
    let prev = null;
    for (const t of turns) {
      const service = t.role === 'assistant' ? serviceOf(t.model) : null;
      if (!service) continue;
      if (prev && service !== prev)
        out[String(t.id)] = DIVIDER[service]({ model: modelLabel(String(t.model), modelNames) });
      prev = service;
    }
    return out;
  });
  // The wait card: the server's notice for a later step, or `submitted` lasting WAIT_NOTICE_MS.
  let submittedLong = $state(false);
  $effect(() => {
    if (conv.assistant?.chat.status !== 'submitted') {
      submittedLong = false;
      return;
    }
    const t = setTimeout(() => (submittedLong = true), WAIT_NOTICE_MS);
    return () => clearTimeout(t);
  });
  const waitInfo = $derived.by(() => {
    const list = conv.models;
    const w = conv.waiting;
    const model = w?.model ?? (submittedLong && list ? chosen : null);
    if (!model) return null;
    const next = w ? w.next : list ? nextCandidate(model, list) : undefined;
    // switching by hand: only within what the list offers, never out of GWDG
    return { model, next, canSwitch: !!list && !!next && !isOutside(next) };
  });
  // An answer action's yes/no question (the LiaScript preview warning), in the app's modal grammar.
  let confirmAsk = $state.raw(
    /** @type {{ text: string, resolve: (ok: boolean) => void } | null} */ (null)
  );
  /** @param {boolean} ok */
  function answerConfirm(ok) {
    confirmAsk?.resolve(ok);
    confirmAsk = null;
  }

  // Phase 7: the publish modal (and with it the publish stack) loads only when opened.
  const lessonPublish = lazyComponent(() => import('./LessonPublishModal.svelte'));
  let publishOpen = $state(false);
  // the turns' saved wraps (the state keeps its own; the modal prefers those)
  const draftWraps = $derived(
    Object.assign({}, ...turns.map((t) => /** @type {any} */ (t).artifacts?.draftWraps ?? {}))
  );
  // the licence proposal reads the sources part (see defaultLicence)
  const sourcesText = $derived(
    turns
      .flatMap((t) => /** @type {any} */ (t).lessonParts ?? [])
      .filter((p) => p.kind === 'sources')
      .map((p) => p.text)
      .join('\n')
  );
  // every part the answers carry, one per key (a later rewrite wins): phase 7 lists and saves them
  const turnParts = $derived([
    ...new Map(
      turns.flatMap((t) =>
        /** @type {any} */ (t.lessonParts ?? []).map(
          (/** @type {import('$lib/termi/lesson-state.js').LessonPartText} */ part) => [
            partKey(part),
            { turnId: /** @type {string} */ (t.id), part }
          ]
        )
      )
    ).values()
  ]);
  /** The per-turn "Als Entwurf speichern" path, for some of a turn's parts (the turn read fresh). */
  const saveTurnParts = (
    /** @type {string} */ turnId,
    /** @type {import('$lib/termi/lesson-state.js').LessonPartText[]} */ parts,
    /** @type {((key: string) => void) | undefined} */ onStart = undefined
  ) => {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) return Promise.reject(new Error('turn gone'));
    return saveLessonParts(turn, parts, bubbleCtx.actionCtx, onStart);
  };
  // a running chat, or a restored conversation in the Werkbank: no starter chips, a way out instead
  const started = $derived(!!conv.assistant || (workbench && turns.length > 0));
  const showCapabilities = $derived(
    !started && turns.length === 0 && !imports.attachment && capabilities.cards.length > 0
  );
  const latestAssistantId = $derived(turns.findLast((t) => t.role === 'assistant')?.id);

  // Werkbank: the draft's parts, the rail's rows, the part on the desk.
  const werkbankRail = lazyComponent(() => import('./werkbank/WerkbankRail.svelte'));
  const werkbankDoc = lazyComponent(() => import('./werkbank/WerkbankDoc.svelte'));
  const werkbankStep = lazyComponent(() => import('./werkbank/WerkbankStep.svelte'));
  const parts = $derived(partsOf(turns, conv.task));
  // a saved ask document is a stub until its wrap is read: it already counts, or nothing would load it
  const draftOpen = $derived(
    conv.task === 'lesson' ||
      parts.length > 0 ||
      turns.some((t) => t.textStub && t.artifacts?.draftWraps?.document)
  );
  // an ask document's one part: "Veröffentlichen…" hands its turn to the article action
  const docPart = $derived(
    conv.task === 'lesson' ? undefined : parts.find((p) => p.key === 'document')
  );
  function publishDocument() {
    const turn = turns.find((t) => t.id === docPart?.turnId);
    const article = ANSWER_ACTIONS.find((a) => a.id === 'article');
    if (turn && article) void runAnswerAction(turn, article, bubbleCtx.actionCtx);
  }
  // part key → the turn whose draftWraps holds it (the latest wins)
  const partWraps = $derived(
    Object.fromEntries(
      turns.flatMap((t) =>
        Object.keys(/** @type {any} */ (t).artifacts?.draftWraps ?? {}).map((k) => [
          k,
          String(t.id)
        ])
      )
    )
  );
  // part keys of stored drafts that would not open (replaced, never mutated)
  let loadFailed = $state.raw(/** @type {Set<string>} */ (new Set()));
  // a run says what it writes; otherwise the part a pending answer carries
  const writingKey = $derived(
    runState.writing ?? parts.findLast((p) => turns.find((t) => t.id === p.turnId)?.pending)?.key
  );
  const rows = $derived(
    // by task: an ask record saved before 2026-11-12 carries a lesson state for its document wrap
    railRows(conv.task === 'lesson' ? (conv.lessonState ?? { phase: 1 }) : null, parts, {
      writingKey,
      failedKey: runState.failed ?? (runState.writing ? undefined : loadFailed),
      wraps: partWraps
    })
  );
  // Saving on its own (Werkbank only): whenever the chat is idle (between a run's parts too, and
  // when a conversation opens), every part whose wrap is not its turn's gets saved. One pass at a time.
  let saving = false;
  let again = false;
  let saveFailed = $state(false);
  // turn+key+text already written: a pass never writes the same thing twice (a runaway loop of signer prompts)
  const savedOnce = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
  async function savePass() {
    if (saving) {
      again = true;
      return;
    }
    saving = true;
    try {
      do {
        again = false;
        /** @type {Map<string, any[]>} */
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to one pass
        const byTurn = new Map();
        for (const p of parts)
          if (
            partWraps[p.key] !== p.turnId &&
            !unloadedStub(p) &&
            !savedOnce.has(`${p.turnId}\n${p.key}\n${p.text}`)
          )
            byTurn.set(p.turnId, [...(byTurn.get(p.turnId) ?? []), p]);
        for (const [turnId, list] of byTurn) {
          await saveTurnParts(turnId, list);
          for (const p of list) savedOnce.add(`${p.turnId}\n${p.key}\n${p.text}`);
        }
      } while (again);
      saveFailed = false;
    } catch (err) {
      // the rows stay `changed`; the next trigger (or her retry) saves again
      saveFailed = true;
      console.error('Termi: saving the Werkbank drafts failed', err);
    } finally {
      saving = false;
    }
  }
  // an answer with this key (earlier or later) is still in its wrap, not loaded: saving would overwrite it
  /** @param {import('$lib/termi/werkbank.js').WerkbankPart} p */
  const unloadedStub = (p) => turns.some((t) => t.textStub && t.artifacts?.draftWraps?.[p.key]);
  $effect(() => {
    void turns; // an opened conversation, a load, a finished answer: each worth a pass
    if (!workbench || conv.chatBusy || !getActiveUser()) return;
    untrack(() => void savePass());
  });

  // Opening a stored conversation: every stub turn gets its parts back from the wraps — the desk
  // part's turn first, then the rest two at a time (a remote signer decrypts one by one; a burst trips it).
  /** @type {Set<string>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  let loadTried = new Set();
  /** @param {string} turnId */
  async function loadTurn(turnId) {
    const turn = untrack(() => turns.find((t) => t.id === turnId));
    if (!turn) return;
    const keys = Object.keys(turn.artifacts?.draftWraps ?? {});
    const convId = conv.conversationId();
    try {
      await loadTurnDrafts(turn, bubbleCtx.actionCtx);
      if (convId === conv.conversationId())
        loadFailed = new Set([...loadFailed].filter((k) => !keys.includes(k)));
    } catch {
      if (convId === conv.conversationId()) loadFailed = new Set([...loadFailed, ...keys]);
    }
  }
  let loadTriedFor = '';
  $effect(() => {
    if (!workbench || !getActiveUser()) return;
    const stubs = turns.filter((t) => t.textStub && t.artifacts?.draftWraps);
    untrack(() => {
      const id = conv.conversationId();
      if (id !== loadTriedFor) {
        loadTriedFor = id;
        loadTried = new Set();
        loadFailed = new Set();
      }
      const fresh = stubs.filter((t) => !loadTried.has(String(t.id)));
      fresh.forEach((t) => loadTried.add(String(t.id)));
      const desk = selection?.type === 'part' ? selection.key : undefined;
      const queue = fresh.map((t) => String(t.id));
      const first = fresh.findIndex((t) => desk && t.artifacts?.draftWraps?.[desk]);
      if (first > 0) queue.unshift(...queue.splice(first, 1));
      const worker = async () => {
        for (let id; (id = queue.shift()); ) await loadTurn(id);
      };
      const head = queue.shift();
      if (head) void loadTurn(head).then(() => Promise.all([worker(), worker()]));
    });
  });
  // a failed row's click retries its turn's load
  /** @param {{ type: string, key?: string }} sel */
  function retryLoad(sel) {
    if (sel.type !== 'part' || !sel.key || !loadFailed.has(sel.key)) return;
    const turn = turns.find((t) => t.textStub && sel.key && t.artifacts?.draftWraps?.[sel.key]);
    if (turn) void loadTurn(String(turn.id));
  }
  /** @typedef {{ type: 'step', n: number } | { type: 'part', key: string } | null} Selection */
  let selected = $state(/** @type {Selection} */ (null));
  // her pick while it still exists; else the part being written, the current step, the first part
  const selection = $derived.by(() => {
    const s = selected;
    if (s?.type === 'step' && rows.steps.some((r) => r.n === s.n && r.state !== 'todo')) return s;
    if (s?.type === 'part' && rows.parts.some((r) => r.key === s.key)) return s;
    if (writingKey) return /** @type {Selection} */ ({ type: 'part', key: writingKey });
    const step = rows.steps.find((r) => r.state === 'current');
    if (step) return /** @type {Selection} */ ({ type: 'step', n: step.n });
    return parts[0] ? /** @type {Selection} */ ({ type: 'part', key: parts[0].key }) : null;
  });
  const deskPart = $derived(
    selection?.type === 'part' ? (parts.find((p) => p.key === selection.key) ?? null) : null
  );
  // competences this session offered that the plan lacks (gone after a reload)
  const foundCompetenceList = $derived(
    workbench && selection?.type === 'step' && selection.n === 2
      ? foundCompetences(
          conv.assistant?.chat.messages ?? [],
          conv.lessonState?.competences ?? [],
          conv.lessonState?.frame
        )
      : []
  );
  /** A form's button talks to the model; never an attachment's instruction. @param {string} q */
  const sendFromForm = (q) => send(q, { fromOption: true });

  // The run (createRun): a message typed meanwhile is queued and goes out between two parts.
  const planned = $derived(conv.lessonState?.plan?.length ? plannedKeys(conv.lessonState) : []);
  const plannedDone = $derived(planned.filter((k) => parts.some((p) => p.key === k)).length);
  // all planned parts written: the optional ones still missing, as chips
  const moreParts = $derived(
    planned.length && plannedDone === planned.length && !runState.writing
      ? ['worksheets', 'module', 'sources'].filter((k) => !parts.some((p) => p.key === k))
      : []
  );
  /** Sends one message and resolves when its answer is finished; throws when it was refused or the window, account or conversation changed meanwhile. @param {string} text */
  async function sendAndWait(text) {
    const pubkey = getActiveUser()?.pubkey;
    const id = conv.conversationId();
    if (!conv.ask(text)) throw new Error('not sent');
    await conv.inflight;
    if (
      windowGone ||
      conv.chatError ||
      !conv.assistant ||
      pubkey !== getActiveUser()?.pubkey ||
      id !== conv.conversationId()
    )
      throw new Error('run stopped');
  }
  function startRun() {
    if (!run) {
      const own = createRun({
        next: () => nextPartKey(conv.lessonState, partsOf(conv.turnsNow(), conv.task)),
        write: (key) => sendAndWait(m.termi_werkbank_write_part({ part: partTitle(key) })),
        sendQueued: (text) => {
          queued = queued.slice(1);
          return sendAndWait(text);
        },
        onState: (s) => {
          if (run !== own) return; // a run of an earlier conversation
          runState = s;
          if (s.writing) return;
          pausing = false;
          if (s.paused) return;
          run = null;
          // what a stopped run never sent goes back to the composer, never lost
          if (queued.length) input = [input, ...queued].filter(Boolean).join('\n\n');
          queued = [];
        }
      });
      run = own;
    }
    void run.start();
  }
  function pauseRun() {
    pausing = true;
    run?.pause();
  }
  // the open part goes with her next message (never while a run writes)
  $effect(() => {
    const key = workbench && !runState.writing ? deskPart?.key : undefined;
    untrack(() => conv.setFocus(key ?? null));
  });
  // What Termi is doing now: a running search, else the part being written.
  const say = {
    curriculum: (/** @type {string} */ query) => m.termi_werkbank_activity_curriculum({ query }),
    material: (/** @type {string} */ query) => m.termi_werkbank_activity_material({ query })
  };
  const activity = $derived.by(() => {
    if (!conv.chatBusy) return null;
    const msg = conv.assistant?.chat.messages.at(-1);
    const parts = msg?.role === 'assistant' ? /** @type {any[]} */ (msg.parts) : [];
    for (let i = parts.length - 1; i >= 0; i--) {
      const a = activityOf(parts[i], say);
      if (a) return a;
    }
    return writingKey ? m.termi_werkbank_activity_writing({ part: partTitle(writingKey) }) : null;
  });
  const lines = $derived(workbench ? partLines(turns, conv.task) : {});
  const draftTitle = $derived(
    conv.lessonState?.frame?.topic || parts.find((p) => p.key === 'document')?.title || ''
  );
  const frameChips = $derived.by(() => {
    const f = conv.lessonState?.frame ?? {};
    return [
      f.subject,
      f.grade !== undefined && m.termi_werkbank_grade({ grade: f.grade }),
      f.state,
      conv.lessonState?.licence
    ].filter((c) => typeof c === 'string' && c);
  });

  // with a draft open the header's expand button toggles the Werkbank instead of the side panel
  const wide = $derived(draftOpen ? workbench : expanded);
  const wideLabel = $derived(
    draftOpen
      ? workbench
        ? m.termi_werkbank_close_aria()
        : m.termi_werkbank_open_aria()
      : expanded
        ? m.termi_collapse_aria()
        : m.termi_expand_aria()
  );

  // A draft opens the Werkbank by itself unless she closed it by hand in this conversation.
  // A draft that is briefly gone (a regenerating answer) never closes it; another conversation
  // without a draft (a new one) does.
  const workbenchClosed = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
  let deskFor = '';
  $effect(() => {
    const id = untrack(() => conv.conversationId());
    if (!draftOpen) {
      if (workbench && id !== deskFor) untrack(() => onWorkbench?.(false));
      return;
    }
    deskFor = id;
    if (workbenchClosed.has(id)) return;
    untrack(() => onWorkbench?.(true));
  });
  // The conversation's link rules: a link is clickable only when a tool result of this chat holds its target.
  // Keyed by the allowed targets: `turns` is rebuilt per streamed token, the kit (and with it every
  // bubble's HTML) must only change when a tool result adds a target.
  const linkKey = $derived([...allowedLinks(turns, globalThis.location?.origin)].sort().join('\n'));
  const links = $derived.by(() => {
    void linkKey;
    return untrack(() => linkKit(turns, globalThis.location?.origin));
  });
  // An in-app link: the page opens behind Termi (it stays open); the Werkbank steps aside and stays
  // closed for this conversation, or the auto-enter effect would reopen it at once.
  function openLink(/** @type {string} */ href) {
    if (workbench) {
      workbenchClosed.add(conv.conversationId());
      onWorkbench?.(false);
    }
    host?.navigate(href);
  }
  function toggleWorkbench() {
    if (workbench) workbenchClosed.add(conv.conversationId());
    onWorkbench?.(!workbench);
  }

  const bubbleCtx = {
    get latestId() {
      return latestAssistantId;
    },
    retryOf: conv.retryOf,
    get modelNames() {
      return modelNames;
    },
    regenerate: () => conv.talk((chat) => chat.regenerate()),
    onSearchAuthor: searchAuthor,
    // an option click is a typed message: the composer path, history and consent as usual
    send: (/** @type {string} */ text) => send(text, { fromOption: true }),
    canPick: conv.canPick,
    get workbench() {
      return workbench;
    },
    get partLines() {
      return lines;
    },
    onShowPart: (/** @type {string} */ key) => {
      selected = { type: 'part', key };
      closeChat();
    },
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
      replaceTurnText: conv.replaceTurnText,
      get lessonState() {
        return conv.lessonState;
      },
      get workbench() {
        return workbench;
      },
      isLatest: (/** @type {string} */ id) => id === latestAssistantId,
      openLessonPublish: () => (publishOpen = true),
      get links() {
        return links;
      }
    },
    importActions: {
      reextract: imports.reextract,
      publish: imports.publish,
      retry: imports.retry,
      update: conv.patchImport,
      stop: imports.stop
    }
  };

  // Scrolling follows the conversation, never the stream: a new answer is
  // read from its first line, so its bubble's top is aligned with the body
  // (laoc, 2026-11-11); the user's own turn, the typing dots and hints scroll
  // to the bottom as before; tokens arriving in an existing turn move nothing.
  // The reactive deps are read before the DOM is touched, so the effect re-runs on every change.
  let seenTurns = 0;
  $effect(() => {
    const count = turns.length;
    const last = turns[count - 1];
    void typing;
    void hints;
    if (!bodyEl) return;
    const added = count - seenTurns;
    seenTurns = count;
    if (added === 1 && last?.role === 'assistant') {
      const id = last.id;
      void tick().then(() => {
        const el = [...(bodyEl?.querySelectorAll('[data-turn-id]') ?? [])].find(
          (n) => n.getAttribute('data-turn-id') === id
        );
        el?.scrollIntoView?.({ block: 'start' }); // jsdom has no scrollIntoView
      });
    } else if (added !== 0 || (typing && last?.role !== 'assistant')) {
      // dots below the user's turn follow to the bottom; once the answer turn
      // exists the view stays where it was aligned
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  });

  // Werkbank below lg/md: the rail and the chat open as sheets (state only; breakpoints are CSS)
  let railOpen = $state(false);
  let chatOpen = $state(false);
  $effect(() => {
    if (!workbench) railOpen = chatOpen = false;
  });
  /** @type {HTMLElement | undefined} */
  let railToggleEl = $state();
  /** @type {HTMLElement | undefined} */
  let railSheetEl = $state();
  /** @type {HTMLElement | undefined} */
  let barEl = $state();
  /** @type {HTMLElement | undefined} */
  let chatCloseEl = $state();
  async function openRail() {
    railOpen = true;
    await tick();
    /** @type {HTMLElement | null | undefined} */ (
      railSheetEl?.querySelector('button:not([disabled])')
    )?.focus();
  }
  function closeRail() {
    railOpen = false;
    railToggleEl?.focus();
  }
  async function openChat() {
    chatOpen = true;
    await tick();
    chatCloseEl?.focus();
  }
  async function closeChat() {
    if (!chatOpen) return;
    chatOpen = false;
    await tick();
    barEl?.focus();
  }
  // the bar's one line: save failure, activity, the last answer's summary, Termi's last sentence
  const barLine = $derived.by(() => {
    if (saveFailed) return m.termi_werkbank_save_failed();
    if (activity) return activity;
    const last = turns.findLast((t) => t.role === 'assistant');
    const written = lines[String(last?.id)];
    if (written?.length) {
      const title = written.map((l) => l.title).join(', ');
      return written.every((l) => l.changed)
        ? m.termi_werkbank_part_changed({ title })
        : m.termi_werkbank_part_written({ title });
    }
    const sentence = String(last?.text ?? '')
      .split(/<!--/)[0]
      .trim();
    return sentence || m.termi_werkbank_bar_idle();
  });

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    // a sheet closes before the window does
    if (railOpen || chatOpen) {
      e.stopPropagation();
      if (railOpen) closeRail();
      else void closeChat();
      return;
    }
    // an open DaisyUI dropdown (the ⋯ menu) is open while focus is inside it: blurring closes it
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (active?.closest('.dropdown')) {
      e.stopPropagation();
      active.blur();
      return;
    }
    // closing would abort the part being written
    if (workbench && runState.writing) {
      e.stopPropagation();
      return;
    }
    onClose();
  }
</script>

<div
  data-testid="termi-window"
  role="dialog"
  aria-label="Termi"
  tabindex="-1"
  onkeydown={onKeydown}
  onclick={(e) => host && onLinkClick(e, openLink)}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  class="fixed z-[70] flex overflow-hidden bg-base-100 {workbench
    ? 'inset-0'
    : expanded
      ? 'termi-panel-in inset-y-0 right-0 w-[min(560px,100vw)] flex-col border-l border-base-300 shadow-2xl'
      : 'termi-pop-in termi-slot right-4 h-[min(600px,calc(100dvh-10rem))] w-[min(400px,calc(100vw-2rem))] flex-col rounded-2xl border border-base-300 shadow-2xl lg:right-6'}"
>
  {#if dragging}
    <div
      data-testid="termi-drop-overlay"
      class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-base-100/90 text-sm font-semibold text-primary"
    >
      {m.termi_import_drop()}
    </div>
  {/if}
  {#if workbench}
    {@const Rail = werkbankRail.Component}
    {@const Doc = werkbankDoc.Component}
    {#snippet saveFailedNote()}
      {#if saveFailed}
        <div
          role="status"
          class="flex flex-col gap-2 border-t border-base-300 p-3 text-xs text-error"
        >
          {m.termi_werkbank_save_failed()}
          <button
            type="button"
            class="btn btn-sm btn-primary"
            data-testid="werkbank-save-retry"
            onclick={() => void savePass()}>{m.termi_werkbank_save_retry()}</button
          >
        </div>
      {/if}
    {/snippet}
    {#snippet railPicker()}
      <Rail
        {rows}
        selected={selection}
        onselect={(sel) => {
          retryLoad(sel);
          selected = sel;
          if (railOpen) closeRail();
        }}
      />
    {/snippet}
    {#if Rail}
      <!-- lg and up: the left column; below, the same rail opens as a sheet -->
      <div
        class="hidden shrink-0 flex-col border-r border-base-300 bg-base-200 lg:flex [&>nav]:min-h-0 [&>nav]:flex-1"
      >
        {@render railPicker()}
        {@render saveFailedNote()}
      </div>
      <BottomSheet
        open={railOpen}
        title={m.termi_werkbank_rail_sheet()}
        onClose={closeRail}
        testid="werkbank-rail-sheet"
      >
        <div bind:this={railSheetEl} class="[&>nav]:w-full [&>nav]:border-r-0 [&>nav]:p-0">
          {@render railPicker()}
          {@render saveFailedNote()}
        </div>
      </BottomSheet>
    {/if}
    <div class="flex min-w-0 flex-1 flex-col">
      <div
        data-testid="werkbank-header"
        class="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-200 px-4 py-3"
      >
        <span class="badge badge-sm badge-accent">{m.termi_werkbank_draft()}</span>
        <button
          type="button"
          data-testid="werkbank-rail-toggle"
          bind:this={railToggleEl}
          class="btn min-w-0 flex-1 justify-start border border-base-300 font-normal btn-ghost btn-sm lg:hidden"
          onclick={openRail}
          ><span class="truncate"
            >{selection?.type === 'step'
              ? (lessonLabels[selection.n - 1] ?? '')
              : selection?.type === 'part'
                ? (rows.parts.find((r) => r.key === selection.key)?.title ?? '')
                : draftTitle}</span
          >
          ▾</button
        >
        <h2 class="hidden min-w-0 flex-1 truncate text-lg font-bold md:block lg:flex-1">
          {draftTitle}
        </h2>
        {#each frameChips as chip, i (i)}
          <button
            type="button"
            class="btn hidden border border-base-300 font-normal btn-ghost btn-sm md:inline-flex"
            onclick={() => (selected = { type: 'step', n: 1 })}>{chip}</button
          >
        {/each}
        {#if planned.length}
          <progress
            class="progress hidden w-20 progress-primary md:block"
            value={plannedDone}
            max={planned.length}
            aria-label={m.termi_werkbank_progress({ done: plannedDone, total: planned.length })}
          ></progress>
          <span
            class="hidden text-xs text-base-content/60 md:inline"
            data-testid="werkbank-progress"
            >{m.termi_werkbank_progress({ done: plannedDone, total: planned.length })}</span
          >
          {#if runState.writing}
            <button
              type="button"
              data-testid="werkbank-run-pause"
              class="btn btn-sm"
              disabled={pausing}
              onclick={pauseRun}>{m.termi_werkbank_run_pause()}</button
            >
          {:else if plannedDone < planned.length}
            <button
              type="button"
              data-testid="werkbank-run"
              class="btn btn-sm"
              disabled={conv.chatBusy || conv.botTyping}
              onclick={startRun}
              >{runState.paused ? m.termi_werkbank_run_resume() : m.termi_werkbank_run()}</button
            >
          {/if}
        {/if}
        {#if conv.task === 'lesson'}
          <button
            type="button"
            data-testid="werkbank-publish"
            class="btn btn-sm btn-primary max-md:hidden"
            disabled={!parts.length || !conv.lessonState}
            onclick={() => (publishOpen = true)}>{m.termi_werkbank_publish()}</button
          >
        {:else if docPart}
          <button
            type="button"
            data-testid="werkbank-publish"
            class="btn btn-sm btn-primary max-md:hidden"
            disabled={!getActiveUser()}
            onclick={publishDocument}>{m.termi_werkbank_publish()}</button
          >
        {/if}
        <!-- phone: title, the metadata chips' target and publishing live in a menu (top bar does not scroll, so no clip) -->
        <div class="dropdown dropdown-end md:hidden">
          <button
            type="button"
            tabindex="0"
            data-testid="werkbank-menu"
            class="btn btn-circle btn-ghost btn-sm"
            aria-label={m.termi_werkbank_more_aria()}>⋯</button
          >
          <ul
            tabindex="-1"
            class="dropdown-content menu z-[60] w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
          >
            <li class="truncate menu-title">{draftTitle}</li>
            {#each frameChips as chip, i (i)}
              <li>
                <button type="button" onclick={() => (selected = { type: 'step', n: 1 })}
                  >{chip}</button
                >
              </li>
            {/each}
            {#if conv.task === 'lesson' || docPart}
              <li>
                <button
                  type="button"
                  data-testid="werkbank-menu-publish"
                  disabled={conv.task === 'lesson'
                    ? !parts.length || !conv.lessonState
                    : !getActiveUser()}
                  onclick={conv.task === 'lesson' ? () => (publishOpen = true) : publishDocument}
                  >{m.termi_werkbank_publish()}</button
                >
              </li>
            {/if}
          </ul>
        </div>
      </div>
      {#if selection?.type === 'step'}
        {@const Step = werkbankStep.Component}
        {@const n = selection.n}
        {#if Step}
          <Step
            {n}
            lessonState={conv.lessonState}
            found={foundCompetenceList}
            isCurrent={rows.steps.find((r) => r.n === n)?.state === 'current'}
            busy={conv.chatBusy}
            hasParts={parts.length > 0}
            onpatch={(patch) => conv.patchLesson(patch)}
            onnext={() => sendFromForm(m.termi_werkbank_confirm_step({ step: lessonLabels[n] }))}
            onadapt={() => sendFromForm(m.termi_werkbank_adapt_parts_msg())}
            onmore={() => sendFromForm(m.termi_werkbank_more_competences())}
          />
        {/if}
      {:else if Doc}
        <Doc
          part={deskPart}
          turn={turns.find((t) => t.id === deskPart?.turnId)}
          ctx={bubbleCtx.actionCtx}
        />
      {/if}
      {#if moreParts.length}
        <div
          data-testid="werkbank-more-parts"
          class="flex flex-wrap items-center gap-2 border-t border-base-300 px-4 py-3 text-sm"
        >
          <span class="text-base-content/70">{m.termi_werkbank_more_parts()}</span>
          {#each moreParts as key (key)}
            <button
              type="button"
              class="btn border border-base-300 font-normal btn-ghost btn-sm"
              disabled={conv.chatBusy}
              onclick={() => sendFromForm(m.termi_werkbank_write_part({ part: partTitle(key) }))}
              >{partTitle(key)}</button
            >
          {/each}
        </div>
      {/if}
      <button
        type="button"
        data-testid="werkbank-termi-bar"
        bind:this={barEl}
        class="flex items-center gap-2 border-t border-base-300 bg-base-200 px-4 py-3 text-left text-sm max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
        aria-label={m.termi_werkbank_termi_bar({ line: barLine })}
        onclick={openChat}
      >
        <TermiAvatar size={24} />
        <span class="min-w-0 flex-1 truncate">{barLine}</span>
      </button>
    </div>
  {/if}
  <!-- the chat: the whole window, or the Werkbank's right column; below md a sheet over the document -->
  {#if workbench && chatOpen}
    <button
      type="button"
      aria-label={m.termi_werkbank_chat_close()}
      class="fixed inset-0 z-[55] cursor-default bg-(--c-scrim) md:hidden"
      onclick={() => void closeChat()}
    ></button>
  {/if}
  <!-- shortcut: no pull-down-to-close here (the sheet is the desktop column's own DOM, so BottomSheet
       cannot wrap it); wire `swipeDismiss` from $lib/helpers/swipe-dismiss.js once it can be scoped below md -->
  <div
    data-testid="werkbank-chat"
    role={workbench && chatOpen ? 'dialog' : undefined}
    aria-modal={workbench && chatOpen ? 'true' : undefined}
    aria-label={workbench && chatOpen ? m.termi_werkbank_chat_aria() : undefined}
    data-open={workbench ? chatOpen : undefined}
    class={workbench
      ? `flex-col border-l border-base-300 bg-base-100 max-md:pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:flex md:h-auto md:w-[380px] md:shrink-0 md:rounded-none md:shadow-none ${chatOpen ? 'fixed inset-x-0 bottom-0 z-[60] flex h-[85dvh] rounded-t-2xl shadow-2xl' : 'hidden'}`
      : 'contents'}
  >
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
        data-testid="termi-expand"
        class="btn btn-circle text-base-content/60 btn-ghost btn-sm"
        aria-label={wideLabel}
        title={wideLabel}
        onclick={() => (draftOpen ? toggleWorkbench() : onToggleExpand())}
      >
        {#if wide}
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
      {#if workbench}
        <button
          type="button"
          bind:this={chatCloseEl}
          class="btn btn-circle text-base-content/60 btn-ghost btn-sm md:hidden"
          aria-label={m.termi_werkbank_chat_close()}
          onclick={() => void closeChat()}
        >
          ▾
        </button>
      {/if}
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
    {#if conv.task === 'lesson' && !workbench}
      <div
        data-testid="termi-lesson-header"
        class="flex flex-col gap-1.5 border-b border-base-300 bg-base-100 px-4 py-2"
      >
        <div class="text-xs font-semibold text-base-content/70">
          {m.termi_lesson_mode_header({ n: lessonPhase, name: lessonLabels[lessonPhase - 1] })}
        </div>
        <div class="flex gap-1">
          {#each LESSON_PHASES as key, i (key)}
            {@const state =
              i + 1 < lessonPhase ? 'done' : i + 1 === lessonPhase ? 'current' : 'next'}
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
        class="@container flex flex-1 flex-col gap-3 overflow-y-auto p-4 [overflow-anchor:none]"
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

        {#if showCapabilities}
          <CapabilityCards cards={capabilities.cards} onPick={pickCapability} />
        {/if}

        {#each turns as turn (turn.id)}
          {#if dividers[String(turn.id)]}
            <div
              data-testid="termi-model-divider"
              class="flex items-center gap-2 text-xs text-base-content/60 before:h-px before:flex-1 before:bg-base-300 after:h-px after:flex-1 after:bg-base-300"
            >
              {dividers[String(turn.id)]}
            </div>
          {/if}
          <AnswerBubble {turn} ctx={bubbleCtx} />
        {/each}
        {#each queued as text, i (i)}
          <div data-testid="werkbank-queued" class="flex flex-col gap-1">
            <AnswerBubble
              turn={{ id: `queued-${i}`, role: 'user', tier: 2, text }}
              ctx={bubbleCtx}
            />
            <span class="text-right text-xs text-base-content/60">{m.termi_werkbank_queued()}</span>
          </div>
        {/each}

        {#if waitInfo}
          {@const w = waitInfo}
          {#key `${w.model} ${w.next}`}
            <WaitCard
              model={modelLabel(w.model, modelNames)}
              next={w.next && modelLabel(w.next, modelNames)}
              task={conv.task}
              onSwitch={w.canSwitch && w.next && !runState.writing
                ? () => void conv.switchTo(/** @type {string} */ (w.next))
                : undefined}
              onCancel={stopAnswer}
            />
          {/key}
        {:else if typing}
          <div class="flex items-end gap-2.5" data-testid="termi-typing">
            <TermiAvatar />
            <div class="rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-3">
              <span class="termi-typing"><i></i><i></i><i></i></span>
              {#if slow}
                <div class="mt-2 text-xs text-base-content/60" data-testid="termi-slow">
                  {m.termi_slow_hint()}
                </div>
              {/if}
            </div>
          </div>
        {/if}
        {#if waitingMsg}
          <div data-testid="termi-queued" class="flex flex-col gap-1">
            <AnswerBubble
              turn={{ id: 'termi-queued', role: 'user', tier: 2, text: waitingMsg.text }}
              ctx={bubbleCtx}
            />
            <div class="flex items-center justify-end gap-2 text-xs text-base-content/60">
              {m.termi_queue_waiting()}
              <button type="button" class="btn btn-ghost btn-sm" onclick={takeBack}
                >{m.termi_queue_take_back()}</button
              >
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- outside the Werkbank the bubble's own busy line says it; one line, not two -->
    {#if activity && workbench}
      <p data-testid="termi-activity" class="truncate px-4 pb-1.5 text-xs text-base-content/60">
        {activity}
      </p>
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

    <!-- canned suggestions (router mode) / restart (assistant mode, or a draft restored into the Werkbank) -->
    <div class="flex flex-wrap gap-2 px-4 pb-2.5">
      {#if started}
        <button type="button" class="btn btn-ghost btn-sm" onclick={newConversation}>
          {m.termi_history_new()}
        </button>
      {/if}
      <!-- beside the capability cards only the user-guide chip stays -->
      {#each started ? [] : showCapabilities ? conv.suggestions.filter((s) => s.q === m.termi_sugg_4_q()) : conv.suggestions as sugg (sugg.q)}
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
        <!-- the lesson's material goes to the chosen model; an import always to GWDG -->
        {@const outsideMaterial = conv.task === 'lesson' && isOutside(chosen)}
        <div
          data-testid="termi-attachment"
          class="mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs {outsideMaterial
            ? 'border-warning bg-warning/15'
            : 'border-base-300 bg-base-200'}"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold">
              {attachment.file.name}
              <span class="font-normal text-base-content/60">({attachment.size})</span>
            </div>
            <div class="text-base-content/70">
              {outsideMaterial
                ? m.termi_outside_attach_hint()
                : conv.task === 'lesson'
                  ? m.termi_lesson_attach_hint()
                  : m.termi_import_chip_hint()}
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
        <!-- while an answer runs (outside a run, which pauses instead) the send button stops it;
             Enter then queues her next message -->
        {#if conv.chatBusy && !runState.writing}
          <button
            type="button"
            data-testid="termi-stop"
            class="btn h-10 w-10 rounded-xl p-0 btn-primary"
            aria-label={m.termi_stop_aria()}
            title={m.termi_stop_aria()}
            onclick={stopAnswer}
          >
            <StopIcon class_="h-4 w-4" title="" />
          </button>
        {:else}
          <button
            type="submit"
            data-testid="termi-send"
            class="btn h-10 w-10 rounded-xl p-0 btn-primary"
            aria-label={m.termi_send_aria()}
          >
            <SendIcon class_="h-4 w-4" />
          </button>
        {/if}
      </div>
      <!-- the chunk loads once a model list is there -->
      {#if conv.models}
        {@const ModelButton = modelButton.Component}
        {#if ModelButton}<ModelButton {conv} />{/if}
      {/if}
    </form>
  </div>
  {#if publishOpen && conv.lessonState}
    {@const LessonPublishModal = lessonPublish.Component}
    {#if LessonPublishModal}
      <LessonPublishModal
        lessonState={conv.lessonState}
        {draftWraps}
        {sourcesText}
        author={bubbleCtx.actionCtx.author}
        conversationId={conv.conversationId()}
        record={conv.recordPublished}
        {turnParts}
        saveParts={saveTurnParts}
        onClose={() => (publishOpen = false)}
      />
    {/if}
  {/if}
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
