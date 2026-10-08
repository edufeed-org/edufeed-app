<!--
  CallLanding — the guest-link landing page body for `/call/<pointer>#<code>`.
  The code lives in the URL fragment (never sent to a server); this
  component checks it against the relay's pass endpoint, then lets the
  visitor join as a one-tap guest (name only), with their own account if
  logged in, or shows why the link doesn't work.
-->
<script>
  import { untrack } from 'svelte';
  import { checkCallPass, readPassCodeFromHash, hashPassCode } from '$lib/groups/call-passes.js';
  import {
    buildMeetingIcs,
    icsFileName,
    GUEST_EARLY_S,
    GUEST_LATE_S
  } from '$lib/groups/meetings.js';
  import { groupHref } from '$lib/groups/groups.js';
  import { identityToPubkey } from '$lib/groups/livekit.js';
  import {
    getGroupCallState,
    joinGroupCall,
    leaveGroupCall,
    leaveGroupCallWithConfirm,
    callErrorMessage,
    registerCallStageView,
    toggleChatBeside
  } from '$lib/groups/group-call.svelte.js';
  import { trackOnScreen } from '$lib/groups/track-on-screen.js';
  import {
    createGuestAccount,
    isCallGuest,
    forgetGuestAccount
  } from '$lib/groups/guest-account.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import { formatTimestamp, formatTimeOfDay, formatTimeZoneName } from '$lib/helpers/dates.js';
  import { MeetIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { pageTitle } from '$lib/helpers/page-title.js';

  const FORGOTTEN_NOTE_KEY = 'call-landing-forgotten';
  const FORGOTTEN_NOTE_MS = 10_000;
  function takeForgottenNote() {
    try {
      const at = Number(sessionStorage.getItem(FORGOTTEN_NOTE_KEY));
      sessionStorage.removeItem(FORGOTTEN_NOTE_KEY);
      return Date.now() - at < FORGOTTEN_NOTE_MS;
    } catch {
      return false;
    }
  }

  /** @type {{pointer: {id: string, relay: string} | null}} */
  let { pointer } = $props();

  const CallStage = lazyComponent(() => import('./GroupCallStage.svelte'));
  const CallChatPanel = lazyComponent(() => import('./CallChatPanel.svelte'));
  const getActiveUser = useActiveUser();
  const getMyProfile = useUserProfile();
  const call = getGroupCallState();
  const me = $derived(getActiveUser());
  const guestHere = $derived(!!me && isCallGuest(me.pubkey));

  const code = typeof window !== 'undefined' ? readPassCodeFromHash(window.location.hash) : null;
  /** @type {any} */
  let check = $state.raw(null);
  let name = $state('');
  let joining = $state(false);
  let wasInCall = $state(false);
  // Phones: the call chat REPLACES the stage (QA round 2 N1: side by side
  // at 390 px the stage collapsed into a 30 px strip). md+: it sits beside
  // the stage, open by default — the same per-device pref as the member
  // page (call.chatBeside, QA round 2 C-new-3).
  let narrowChatOpen = $state(false);
  // Read right away in the browser: starting narrow would flash the
  // phone layout (chat closed) at md+ before the effect corrects it.
  let wideScreen = $state(
    typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 768px)')?.matches
  );
  $effect(() => {
    const query = window.matchMedia?.('(min-width: 768px)');
    if (!query) return;
    wideScreen = query.matches;
    const onChange = () => (wideScreen = query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });
  const chatOpen = $derived(wideScreen ? call.chatBeside : narrowChatOpen);
  function toggleChat() {
    if (wideScreen) toggleChatBeside();
    else narrowChatOpen = !narrowChatOpen;
  }
  let rechecking = $state(false);
  let forgetConfirmOpen = $state(false);
  // "Vergessen" done: say so here instead of a silent redirect (C-new-5).
  // Removing the account re-mounts the route (the app's account-switch
  // reset), so the note crosses that one re-mount through sessionStorage —
  // read once and only briefly, so a later visit never inherits it.
  let forgotten = $state(takeForgottenNote());
  /** @type {string | null} */
  let guestError = $state(null);

  // Guard against `recheckPass`'s result landing after the component is
  // gone (e.g. the visitor navigated away while "Erneut versuchen" was
  // still in flight).
  let destroyed = false;
  $effect(() => {
    return () => {
      destroyed = true;
    };
  });

  $effect(() => {
    const p = pointer;
    // After the call the end screen runs its own check (below).
    if (!p || !code || untrack(() => wasInCall)) return;
    let alive = true;
    checkCallPass(p.relay, p.id, code).then((/** @type {any} */ r) => {
      if (alive) check = r;
    });
    return () => {
      alive = false;
    };
  });

  // An 'ended' call (the relay removed the guest — e.g. the link was
  // revoked — or the connection died) leaves the in-call shell for the end
  // screen; it was connected before, so `wasInCall` already latched.
  const inCallHere = $derived(
    !!pointer && call.isActiveFor(pointer) && call.phase !== 'idle' && call.phase !== 'ended'
  );
  const removedHere = $derived(
    !!pointer && call.isActiveFor(pointer) && call.phase === 'ended' && call.endReason === 'removed'
  );
  // Only a call that actually connected counts as "was in call" for the
  // post-call thank-you view — `phase` flips to 'ready' as soon as the
  // token is in, BEFORE LiveKit has connected, so a failed-then-left join
  // (token ok, handshake failed) must fall back to the check-driven views
  // instead of claiming the guest attended.
  const readyInCallHere = $derived(
    !!pointer && call.isActiveFor(pointer) && call.phase === 'ready' && call.connected
  );
  $effect(() => {
    if (readyInCallHere) untrack(() => (wasInCall = true));
  });

  const title = $derived(check?.name || pointer?.id || '');
  // A meeting pass's `notBefore`/`expiration` ARE the guest-join window
  // (GUEST_EARLY_S before the meeting's real `start`, GUEST_LATE_S after its
  // `end` — guestWindow() in meetings.js), not the meeting's own start/end.
  // Derive the actual start/end for display and the .ics download; null
  // until the pass check has both fields (a plain call-scoped link, which
  // has no notBefore/expiration windowing, never does).
  const meetingStart = $derived(
    typeof check?.notBefore === 'number' ? check.notBefore + GUEST_EARLY_S : null
  );
  const meetingEnd = $derived(
    typeof check?.expiration === 'number' ? check.expiration - GUEST_LATE_S : null
  );
  // The "Beginnt am ..." display instant: the real meeting start once known,
  // else the raw pass `notBefore` (a non-meeting pass, or before `check` has
  // settled at all).
  const notYetStartTs = $derived(meetingStart ?? check?.notBefore ?? 0);
  // "Am 02.10.2026, 15:20–16:20 Uhr (MESZ)" — the pass check names only the
  // channel (pyramid's callPassCheck returns no meeting title), so the time
  // carries the meeting (QA round 3 C2).
  /** @param {number} ts */
  const fullDate = (ts) =>
    formatTimestamp(ts, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const whenLabel = $derived.by(() => {
    if (meetingStart === null || meetingEnd === null) return '';
    const zone = formatTimeZoneName(meetingStart);
    const start = formatTimeOfDay(meetingStart);
    const end = formatTimeOfDay(meetingEnd);
    const startDate = fullDate(meetingStart);
    const endDate = fullDate(meetingEnd);
    // Past midnight: both days, or "23:30–00:30" would read as backwards.
    return startDate === endDate
      ? m.call_landing_when({ date: startDate, start, end, zone })
      : m.call_landing_when_multiday({ startDate, start, endDate, end, zone });
  });
  // Join window open but the meeting not started yet: "Beginnt um …", not
  // "Läuft gerade" (QA round 3 C3). A timer flips it at the start.
  let nowS = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    if (meetingStart === null) return;
    const delayMs = (meetingStart - Math.floor(Date.now() / 1000)) * 1000 + 50;
    if (delayMs <= 0 || delayMs > 2 ** 31 - 1) return;
    const timer = setTimeout(() => (nowS = Math.floor(Date.now() / 1000)), delayMs);
    return () => clearTimeout(timer);
  });
  const beforeStart = $derived(meetingStart !== null && nowS < meetingStart);
  // The .ics UID: the guest side never learns the meeting's coordinate, so
  // it is derived from the pass (stable per link) — QA round 3 K2.
  let passUid = $state('');
  $effect(() => {
    if (!code) return;
    let alive = true;
    hashPassCode(code).then((h) => {
      if (alive) passUid = `pass-${h.slice(0, 32)}`;
    });
    return () => {
      alive = false;
    };
  });
  // QA K-new-5: an empty document.title made the route announcer read
  // "untitled page". The meeting's name once the pass check has it — never
  // the raw group id (`title`'s fallback): plain "Einladung" until then and
  // for a pass without a name.
  const documentTitle = $derived(
    pageTitle(
      [check?.name ? m.call_page_title({ name: check.name }) : m.call_page_title_plain()],
      runtimeConfig.appName
    )
  );
  // Guards the exact timer and the 60 s fallback against a race: if both
  // fire close together, only the response to the LATEST request is ever
  // applied, however the two in-flight requests resolve. A refused join
  // bumps it too, so a recheck still in flight cannot bring "ready" back.
  let notYetRecheckSeq = 0;
  // The relay refused the token for the pass (revoked / deleted meeting):
  // retrying can never work — show why instead (QA round 3 C4).
  const passRefused = $derived(
    inCallHere && call.phase === 'error' && /** @type {any} */ (call.error)?.reason === 'pass'
  );
  $effect(() => {
    if (!passRefused) return;
    untrack(() => {
      notYetRecheckSeq++;
      check = { valid: false, reason: 'unknown', liveCount: 0 };
      leaveGroupCall();
    });
  });
  const view = $derived.by(() => {
    if (forgotten) return 'forgotten';
    if (!pointer || !code) return 'invalid';
    if (passRefused) return 'invalid';
    if (inCallHere) return 'in-call';
    if (wasInCall) return 'ended';
    if (!check) return 'checking';
    if (check.reason === 'ok') return 'ready';
    if (check.reason === 'not_yet') return 'not_yet';
    // 'unreachable' (the relay's pass endpoint could not be reached) is not
    // the same as an invalid/revoked link — it may well still work on retry.
    if (check.reason === 'unreachable') return 'unreachable';
    return 'invalid';
  });

  // The end screen asks the relay again: a guest who hung up by mistake
  // can come back while the pass still works ("Wieder beitreten"); after the
  // call ended or the link was revoked the relay no longer knows it
  // (C-new-5). `check` is cleared first so the pre-call "ok" never shows
  // the button — the end screen does not depend on `check` otherwise.
  $effect(() => {
    if (view !== 'ended' || !pointer || !code) return;
    const p = pointer;
    let alive = true;
    untrack(() => (check = null));
    checkCallPass(p.relay, p.id, code).then((/** @type {any} */ r) => {
      if (alive && !destroyed) check = r;
    });
    return () => {
      alive = false;
    };
  });
  // 'not_yet': switch to the join screen without a reload. Schedule an
  // exact recheck for the moment the pass's OWN not-before opens — that is
  // when checkCallPass starts answering 'ok', not the later, displayed
  // meeting start (see meetingStart above) — plus a 60 s fallback interval
  // for a skipped exact timer (clock drift, a backgrounded tab) or a wait
  // longer than setTimeout's own cap (a signed 32-bit ms count).
  const NOT_YET_FALLBACK_MS = 60_000;
  const NOT_YET_MAX_TIMEOUT_MS = 2 ** 31 - 1;
  // The ready view re-checks on the same 60 s interval: a meeting deleted or
  // a link revoked while the lobby is open turns it invalid (QA round 3 C4).
  $effect(() => {
    if ((view !== 'not_yet' && view !== 'ready') || !pointer || !code) return;
    const p = pointer;
    const c = code;
    const notBefore = view === 'not_yet' ? check?.notBefore : undefined;
    function recheck() {
      const seq = ++notYetRecheckSeq;
      checkCallPass(p.relay, p.id, c).then((/** @type {any} */ r) => {
        // A background hiccup (network error, 5xx) is no answer: keep the
        // last real one, or the page would leave the waiting view for
        // "unreachable" and stop re-checking for good (final review 1).
        if (r?.reason === 'unreachable') return;
        if (!destroyed && seq === notYetRecheckSeq) check = r;
      });
    }
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutId;
    if (typeof notBefore === 'number') {
      const delayMs = (notBefore - Math.floor(Date.now() / 1000)) * 1000;
      if (delayMs > 0 && delayMs <= NOT_YET_MAX_TIMEOUT_MS)
        timeoutId = setTimeout(recheck, delayMs);
    }
    const intervalId = setInterval(recheck, NOT_YET_FALLBACK_MS);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  });

  /** The .ics for the "not yet" screen — the channel's name as title, this
   * link as the URL (no meeting coordinate is known here, only the pass). */
  function downloadMeetingIcs() {
    if (meetingStart === null || meetingEnd === null) return;
    const ics = buildMeetingIcs({
      title,
      start: meetingStart,
      end: meetingEnd,
      url: `${location.origin}${location.pathname}${location.hash}`,
      uid: passUid || undefined
    });
    const blobUrl = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = icsFileName(title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }

  // Never after a removal: the relay keeps a removed guest out even while
  // the link itself stays valid ("blocked: you were removed").
  const canRejoin = $derived(
    view === 'ended' && !removedHere && check?.reason === 'ok' && !!me?.signer
  );

  let rejoining = $state(false);
  async function rejoin() {
    const user = getActiveUser();
    if (!user?.signer || rejoining) return;
    rejoining = true;
    try {
      await joinAs(user);
    } finally {
      if (!destroyed) rejoining = false;
    }
  }

  // Every call view of this page (stage, chat in its place, connecting,
  // failed) is "the call on screen": the app-level dock never shows on top
  // of the landing page that hosts the call (QA round 2 N1). Untracked like
  // the stage's own registration: the store bumps its own $state.
  /** @param {HTMLElement} node */
  function callViewOnScreen(node) {
    const stop = untrack(() =>
      trackOnScreen(node, () => registerCallStageView(`${location.pathname}${location.hash}`))
    );
    return { destroy: stop };
  }

  /**
   * Re-run the pass check (the "the server could not be reached" retry).
   * Deliberately does NOT null out `check` first: that would flip `view` to
   * 'checking' and unmount the retry button itself mid-request. Keeping the
   * current view up with the button disabled (via `rechecking`) is both the
   * double-click guard and the clearer UI.
   */
  async function recheckPass() {
    if (!pointer || !code || rechecking) return;
    rechecking = true;
    try {
      const result = await checkCallPass(pointer.relay, pointer.id, code);
      if (!destroyed) check = result;
    } finally {
      if (!destroyed) rechecking = false;
    }
  }

  /** @param {{pubkey: string, signer: any}} user */
  async function joinAs(user) {
    if (!pointer || !code) return;
    await joinGroupCall(pointer, user, {
      title,
      href: `${location.pathname}${location.hash}`,
      code
    });
  }

  async function joinAsGuest() {
    if (joining) return;
    guestError = null;
    joining = true;
    try {
      const user = await createGuestAccount(name);
      await joinAs(user);
    } catch (err) {
      if (err instanceof Error && err.message === 'name-required') {
        guestError = m.call_landing_name_required();
      } else {
        console.error('Call guest join failed:', err);
        guestError = m.call_landing_join_failed();
      }
    } finally {
      joining = false;
    }
  }

  async function joinWithAccount() {
    const user = getActiveUser();
    if (user?.signer) await joinAs(user);
  }

  async function retry() {
    const user = getActiveUser();
    if (user?.signer && pointer) {
      await joinGroupCall(pointer, user, {
        title,
        href: `${location.pathname}${location.hash}`,
        code: call.code ?? code ?? undefined
      });
    }
  }

  /** "Vergessen" always asks first — the key is gone from this browser for good. */
  function openForgetConfirm() {
    forgetConfirmOpen = true;
  }
  function cancelForget() {
    forgetConfirmOpen = false;
  }
  function forget() {
    forgetConfirmOpen = false;
    const user = getActiveUser();
    if (pointer && call.isActiveFor(pointer)) leaveGroupCall();
    forgotten = true;
    try {
      sessionStorage.setItem(FORGOTTEN_NOTE_KEY, String(Date.now()));
    } catch {
      /* storage blocked: this instance still shows the note */
    }
    if (user) forgetGuestAccount(user.pubkey);
  }
</script>

<svelte:head>
  <title>{documentTitle}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col" data-testid="call-landing">
  {#if view === 'in-call'}
    <div
      class="flex min-h-0 flex-1 flex-col"
      data-testid="call-landing-in-call"
      use:callViewOnScreen
    >
      {#if call.phase === 'ready' && CallStage.Component}
        <div class="flex min-h-0 flex-1 flex-row">
          {#if wideScreen || !chatOpen}
            <CallStage.Component
              {title}
              {identityToPubkey}
              onLeave={() => leaveGroupCallWithConfirm()}
              onShowChat={toggleChat}
              chatOpen={wideScreen && chatOpen}
              registerView={() => registerCallStageView(`${location.pathname}${location.hash}`)}
            />
          {/if}
          {#if chatOpen && CallChatPanel.Component}
            <div
              class="flex min-h-0 w-full flex-col md:w-96 md:shrink-0 md:border-l md:border-base-300"
            >
              {#if !wideScreen}
                <!-- The way back to the stage while the chat stands in for it. -->
                <div class="flex items-center gap-2 border-b border-base-300 px-3 py-2">
                  <span
                    class="min-w-0 flex-1 cursor-default truncate text-sm font-semibold select-none"
                    >{title}</span
                  >
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    onclick={toggleChat}
                    data-testid="call-landing-chat-back"
                  >
                    <MeetIcon class_="w-4 h-4" title="" />
                    {m.groups_call_return()}
                  </button>
                </div>
              {/if}
              <CallChatPanel.Component {identityToPubkey} {title} onClose={toggleChat} />
            </div>
          {/if}
        </div>
      {:else if call.phase === 'error'}
        <div
          class="m-auto flex flex-col items-center gap-3 p-6 text-center"
          data-testid="call-landing-error"
        >
          <p class="text-error">{callErrorMessage(call.error)}</p>
          <div class="flex gap-2">
            <button class="btn btn-sm btn-primary" onclick={retry} data-testid="call-landing-retry">
              {m.groups_call_retry()}
            </button>
            <button
              class="btn btn-ghost btn-sm"
              onclick={leaveGroupCall}
              data-testid="call-landing-back"
            >
              {m.call_landing_back()}
            </button>
            {#if guestHere}
              <button
                class="btn text-error btn-ghost btn-sm"
                onclick={openForgetConfirm}
                data-testid="call-landing-forget"
              >
                {m.call_landing_forget()}
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="m-auto">
          <span class="loading loading-lg loading-spinner text-primary"></span>
        </div>
      {/if}
    </div>
  {:else}
    <div class="mx-auto w-full max-w-md p-6">
      <div class="card bg-base-100 shadow">
        <div class="card-body gap-4">
          {#if view === 'checking'}
            <!-- An unknown code takes the relay a moment (QA K6: ~2.5 s of
              an empty card) — say what is happening. -->
            <div
              class="flex flex-col items-center gap-2 py-4 text-center"
              role="status"
              data-testid="call-landing-checking"
            >
              <span class="loading loading-md loading-spinner text-primary"></span>
              <p class="text-sm text-base-content/70">{m.call_landing_checking()}</p>
            </div>
          {:else if view === 'unreachable'}
            <div data-testid="call-landing-unreachable">
              <p class="text-sm text-base-content/70">{m.call_landing_unreachable()}</p>
              <button
                class="btn mt-2 btn-sm"
                onclick={recheckPass}
                disabled={rechecking}
                data-testid="call-landing-recheck"
              >
                {m.groups_call_retry()}
              </button>
            </div>
          {:else if view === 'invalid'}
            <div data-testid="call-landing-invalid">
              <h1 class="text-xl font-bold">{m.call_landing_invalid_title()}</h1>
              <p class="text-sm text-base-content/70">
                {check?.reason === 'call_ended'
                  ? m.call_landing_ended_call()
                  : check?.reason === 'expired'
                    ? m.call_landing_expired()
                    : m.call_landing_invalid()}
              </p>
              <a class="btn mt-2 btn-sm" href="/">{m.call_landing_to_app()}</a>
            </div>
          {:else if view === 'not_yet'}
            <div data-testid="call-landing-not-yet" class="flex flex-col gap-3">
              <h1 class="text-xl font-bold">{m.call_landing_invited({ title })}</h1>
              <p class="text-sm" data-testid="call-landing-when">
                {whenLabel ||
                  m.call_landing_starts({
                    date: formatTimestamp(notYetStartTs, {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    }),
                    time: formatTimeOfDay(notYetStartTs)
                  })}
              </p>
              {#if meetingStart !== null && meetingEnd !== null}
                <button
                  type="button"
                  class="btn self-start btn-sm"
                  onclick={downloadMeetingIcs}
                  data-testid="call-landing-ics"
                >
                  {m.call_landing_ics_download()}
                </button>
              {/if}
              {#if !me}
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium" for="call-guest-name-early"
                    >{m.call_landing_name_label()}</label
                  >
                  <input
                    id="call-guest-name-early"
                    class="input-bordered input"
                    bind:value={name}
                    maxlength="80"
                    data-testid="call-landing-name-early"
                  />
                </div>
              {/if}
            </div>
          {:else if view === 'ready'}
            <h1 class="text-xl font-bold">{m.call_landing_invited({ title })}</h1>
            {#if whenLabel}
              <p class="text-sm" data-testid="call-landing-when">{whenLabel}</p>
            {/if}
            {#if beforeStart && meetingStart !== null}
              <p class="text-sm text-base-content/70" data-testid="call-landing-status">
                {m.call_landing_early({ time: formatTimeOfDay(meetingStart) })}
              </p>
            {:else if (check?.liveCount ?? 0) > 0 || meetingStart === null}
              <!-- A meeting says "Läuft gerade" only with people in it. -->
              <p class="text-sm text-base-content/70" data-testid="call-landing-status">
                {#if (check?.liveCount ?? 0) === 0}
                  {m.call_landing_live_empty()}
                {:else if check?.liveCount === 1}
                  {m.call_landing_live_one()}
                {:else}
                  {m.call_landing_live({ count: check?.liveCount ?? 0 })}
                {/if}
              </p>
            {/if}
            {#if me}
              {#if me.signer}
                <button
                  class="btn btn-primary"
                  onclick={joinWithAccount}
                  data-testid="call-landing-join-as"
                >
                  {m.call_landing_join_as()}
                </button>
                <a
                  class="link text-sm"
                  href={pointer ? groupHref(pointer) : '/'}
                  data-testid="call-landing-channel"
                >
                  {m.call_landing_open_channel()}
                </a>
              {:else}
                <p class="text-sm text-error" data-testid="call-landing-no-signer">
                  {m.call_landing_no_signer()}
                </p>
                <button
                  class="btn btn-sm"
                  onclick={() => modalStore.openModal('login')}
                  data-testid="call-landing-switch-login"
                >
                  {m.call_landing_login()}
                </button>
              {/if}
            {:else}
              <form
                class="flex flex-col gap-2"
                onsubmit={(e) => {
                  e.preventDefault();
                  joinAsGuest();
                }}
              >
                <label class="text-sm font-medium" for="call-guest-name"
                  >{m.call_landing_name_label()}</label
                >
                <input
                  id="call-guest-name"
                  class="input-bordered input"
                  bind:value={name}
                  maxlength="80"
                  data-testid="call-landing-name"
                />
                {#if guestError}<p class="text-sm text-error">{guestError}</p>{/if}
                <button
                  type="submit"
                  class="btn btn-primary"
                  disabled={joining}
                  data-testid="call-landing-join"
                >
                  {#if joining}<span class="loading loading-sm loading-spinner"></span>{/if}
                  {m.call_landing_join()}
                </button>
              </form>
              <div class="flex flex-wrap gap-2">
                <button
                  class="btn btn-ghost btn-sm"
                  onclick={() => modalStore.openModal('login')}
                  data-testid="call-landing-login"
                >
                  {m.call_landing_login()}
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  onclick={() => modalStore.openModal('signup')}
                  data-testid="call-landing-signup"
                >
                  {m.call_landing_full_profile()}
                </button>
              </div>
            {/if}
          {:else if view === 'ended'}
            <div data-testid="call-landing-ended" class="flex flex-col gap-3">
              <h1 class="text-xl font-bold">
                {removedHere ? m.call_landing_removed_title() : m.call_landing_after_title()}
              </h1>
              {#if removedHere}
                <p class="text-sm text-base-content/70" data-testid="call-landing-removed">
                  {m.call_landing_removed()}
                </p>
              {/if}
              {#if canRejoin}
                <button
                  class="btn btn-primary"
                  onclick={rejoin}
                  disabled={rejoining}
                  data-testid="call-landing-rejoin"
                >
                  {m.call_landing_rejoin()}
                </button>
              {/if}
              {#if guestHere}
                <p class="text-sm text-base-content/70">{m.call_landing_keep_identity()}</p>
                <button
                  class="btn {canRejoin ? '' : 'btn-primary'}"
                  onclick={() => modalStore.openModal('recovery-download')}
                  data-testid="call-landing-backup"
                >
                  {m.call_landing_backup()}
                </button>
                <button
                  class="btn"
                  onclick={() =>
                    modalStore.openModal('signup', {
                      externalSignup: true,
                      initialName: getMyProfile()?.name || name
                    })}
                  data-testid="call-landing-complete"
                >
                  {m.call_landing_complete_profile()}
                </button>
                <button
                  class="btn text-error btn-ghost"
                  onclick={openForgetConfirm}
                  data-testid="call-landing-forget"
                >
                  {m.call_landing_forget()}
                </button>
              {:else}
                <a
                  class="btn {canRejoin ? '' : 'btn-primary'}"
                  href={pointer ? groupHref(pointer) : '/'}>{m.call_landing_open_channel()}</a
                >
              {/if}
            </div>
          {:else if view === 'forgotten'}
            <div data-testid="call-landing-forgotten" class="flex flex-col gap-3" role="status">
              <p class="text-sm">{m.call_landing_forgotten()}</p>
              <a class="btn btn-sm" href="/">{m.call_landing_to_app()}</a>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

{#if forgetConfirmOpen}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="text-lg font-extrabold">{m.call_landing_forget_confirm_title()}</h3>
      <p class="my-3 text-sm text-base-content/70">{m.call_landing_forget_confirm_text()}</p>
      <div class="modal-action justify-center">
        <button
          class="btn btn-ghost"
          onclick={cancelForget}
          data-testid="call-landing-forget-cancel"
        >
          {m.call_landing_cancel()}
        </button>
        <button class="btn btn-error" onclick={forget} data-testid="call-landing-forget-confirm">
          {m.call_landing_forget()}
        </button>
      </div>
    </div>
  </div>
{/if}
