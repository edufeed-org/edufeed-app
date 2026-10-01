<!--
  CallLanding — the guest-link landing page body for `/call/<pointer>#<code>`.
  The code lives in the URL fragment (never sent to a server); this
  component checks it against the relay's pass endpoint, then lets the
  visitor join as a one-tap guest (name only), with their own account if
  logged in, or shows why the link doesn't work.
-->
<script>
  import { untrack } from 'svelte';
  import { checkCallPass, readPassCodeFromHash } from '$lib/groups/call-passes.js';
  import { groupHref } from '$lib/groups/groups.js';
  import { identityToPubkey } from '$lib/groups/livekit.js';
  import {
    getGroupCallState,
    joinGroupCall,
    leaveGroupCall,
    callErrorMessage,
    registerCallStageView
  } from '$lib/groups/group-call.svelte.js';
  import {
    createGuestAccount,
    isCallGuest,
    forgetGuestAccount
  } from '$lib/groups/guest-account.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import { formatTimestamp } from '$lib/helpers/dates.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{pointer: {id: string, relay: string} | null}} */
  let { pointer } = $props();

  const CallStage = lazyComponent(() => import('./GroupCallStage.svelte'));
  const CallChatPanel = lazyComponent(() => import('./CallChatPanel.svelte'));
  const getActiveUser = useActiveUser();
  const getMyProfile = useUserProfile();
  const call = getGroupCallState();

  const code = typeof window !== 'undefined' ? readPassCodeFromHash(window.location.hash) : null;
  /** @type {any} */
  let check = $state.raw(null);
  let name = $state('');
  let joining = $state(false);
  let wasInCall = $state(false);
  let chatOpen = $state(false);
  let rechecking = $state(false);
  let forgetConfirmOpen = $state(false);
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
    if (!p || !code) return;
    let alive = true;
    checkCallPass(p.relay, p.id, code).then((/** @type {any} */ r) => {
      if (alive) check = r;
    });
    return () => {
      alive = false;
    };
  });

  const inCallHere = $derived(!!pointer && call.isActiveFor(pointer) && call.phase !== 'idle');
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
  const view = $derived.by(() => {
    if (!pointer || !code) return 'invalid';
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
    if (user) forgetGuestAccount(user.pubkey);
    location.href = '/';
  }

  const me = $derived(getActiveUser());
  const guestHere = $derived(!!me && isCallGuest(me.pubkey));
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="call-landing">
  {#if view === 'in-call'}
    {#if call.phase === 'ready' && CallStage.Component}
      <div class="flex min-h-0 flex-1 flex-row">
        <CallStage.Component
          {title}
          {identityToPubkey}
          onLeave={leaveGroupCall}
          onShowChat={() => (chatOpen = !chatOpen)}
          {chatOpen}
          registerView={() => registerCallStageView(`${location.pathname}${location.hash}`)}
        />
        {#if chatOpen && CallChatPanel.Component}
          <div class="flex min-h-0 w-full flex-col border-l border-base-300 md:w-96">
            <CallChatPanel.Component {identityToPubkey} />
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
  {:else}
    <div class="mx-auto w-full max-w-md p-6">
      <div class="card bg-base-100 shadow">
        <div class="card-body gap-4">
          {#if view === 'checking'}
            <span class="loading mx-auto loading-md loading-dots"></span>
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
            <div data-testid="call-landing-not-yet">
              <h1 class="text-xl font-bold">{m.call_landing_invited({ title })}</h1>
              <p class="text-sm">
                {m.call_landing_starts({
                  when: formatTimestamp(check?.notBefore ?? 0, {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                })}
              </p>
            </div>
          {:else if view === 'ready'}
            <h1 class="text-xl font-bold">{m.call_landing_invited({ title })}</h1>
            <p class="text-sm text-base-content/70">
              {#if (check?.liveCount ?? 0) === 0}
                {m.call_landing_live_empty()}
              {:else if check?.liveCount === 1}
                {m.call_landing_live_one()}
              {:else}
                {m.call_landing_live({ count: check?.liveCount ?? 0 })}
              {/if}
            </p>
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
              <h1 class="text-xl font-bold">{m.call_landing_after_title()}</h1>
              {#if guestHere}
                <p class="text-sm text-base-content/70">{m.call_landing_keep_identity()}</p>
                <button
                  class="btn btn-primary"
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
                <a class="btn btn-primary" href={pointer ? groupHref(pointer) : '/'}
                  >{m.call_landing_open_channel()}</a
                >
              {/if}
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
