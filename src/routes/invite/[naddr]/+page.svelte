<!--
  /invite/[naddr] — Concord join-by-link landing page (Task 12).

  Imports getConcordClient/getConcordState DIRECTLY from client.svelte.js,
  not the $lib/concord barrel: the barrel re-exports storage.js, which
  imports the applesauce-core-concord package at module scope. This route
  has ssr=false, but the import graph is still analyzed at build time, so
  we follow the same submodule-import convention as
  ChannelInviteSheet.svelte / PrivateChannelsView (see index.js's header
  comment and the @noble/hashes v2 SSR-chunk incident, commit a9af9c87).

  joinByLink error shapes — verified against
  node_modules/applesauce-concord/dist/client/client.js (package version
  0.0.0-concord-20260714212055), which has NO typed error class; every
  failure is a plain `new Error(string)`:
    - "invite bundle not found or revoked" (client.js:318) — no live
      (valid + non-revoked) 33301 bundle event answered within the 10s
      request timeout. Covers a genuinely revoked link AND a link whose
      bundle never reaches us (bootstrap relay down, wrong token, etc.);
      the copy below still reads correctly for both ("no longer valid").
    - "invite expired" (client.js:341) — bundle found and self-certified,
      but bundle.expires_at is in the past.
    - "invite failed owner verification" (client.js:322) — bundle found but
      failed the CORD-05 §1 self-certification check. NOT classified as
      "revoked": this is a distinct (and more suspicious) failure mode, so
      it falls through to the generic error pane with the raw message.
  Matched by exact string (not regex) since these are stable, literal
  messages in the installed package, not user-facing text we control.
-->
<script>
  import { goto } from '$app/navigation';
  import { getConcordClient, getConcordState } from '$lib/concord/client.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();
  let phase = $state('idle'); // idle | joining | joined | revoked | error
  let errorMessage = $state('');

  // Named `concordState`, not `state`: a local var literally named `state`
  // collides with the `$state` rune (Svelte tries to auto-subscribe `$state`
  // as a store reference to it) and fails to compile.
  const concordState = $derived(getConcordState());

  // Bundle-terminal errors thrown by ConcordClient#joinByLink whose copy
  // ("withdrawn by the channel admins") fits — see header comment.
  const REVOKED_MESSAGES = new Set(['invite bundle not found or revoked', 'invite expired']);

  async function join() {
    phase = 'joining';
    try {
      const client = getConcordClient();
      if (!client) throw new Error('client not ready');
      await client.joinByLink(window.location.href);
      phase = 'joined';
      // Community page can't be derived from the bundle alone in every case;
      // go to communities overview — the joined area is reachable from there.
      setTimeout(() => goto('/communities'), 1200);
    } catch (/** @type {any} */ error) {
      console.error('concord: joinByLink failed', error);
      const message = String(error?.message || error);
      phase = REVOKED_MESSAGES.has(message) ? 'revoked' : 'error';
      errorMessage = message;
    }
  }
</script>

<div class="grid min-h-[70vh] place-items-center p-6">
  <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
    {#if !runtimeConfig.concord?.enabled}
      <h3 class="text-lg font-extrabold">{m.concord_join_disabled_title()}</h3>
      <p class="mt-2 text-sm text-base-content/60">{m.concord_join_disabled_body()}</p>
    {:else if !getActiveUser()}
      <h3 class="text-lg font-extrabold">{m.concord_join_login_title()}</h3>
      <p class="mt-2 text-sm text-base-content/60">{m.concord_join_login_body()}</p>
    {:else if phase === 'revoked'}
      <div class="mb-2 text-2xl">⚠️</div>
      <h3 class="text-lg font-extrabold">{m.concord_join_revoked_title()}</h3>
      <p class="mt-2 text-sm text-base-content/60">{m.concord_join_revoked_body()}</p>
    {:else if phase === 'error'}
      <div class="mb-2 text-2xl">⚠️</div>
      <h3 class="text-lg font-extrabold">{m.concord_join_error_title()}</h3>
      <p class="mt-2 text-xs break-all text-base-content/50">{errorMessage}</p>
    {:else if phase === 'joined'}
      <div class="mb-2 text-2xl">✓</div>
      <h3 class="text-lg font-extrabold">{m.concord_join_success()}</h3>
    {:else if concordState.phase === 'error'}
      <!-- The Concord client itself failed to start (e.g. bad relay config)
        before the user ever clicked Join — show the failure instead of a
        button that would stay disabled with an infinite spinner. -->
      <div class="mb-2 text-2xl">⚠️</div>
      <h3 class="text-lg font-extrabold">{m.concord_join_error_title()}</h3>
      <p class="mt-2 text-xs break-all text-base-content/50">{concordState.error}</p>
    {:else}
      <div class="mb-2 text-2xl">🔒</div>
      <p class="text-xs font-bold tracking-wider text-primary uppercase">
        {m.concord_join_overline()}
      </p>
      <h3 class="mt-1 text-lg font-extrabold">{m.concord_join_title()}</h3>
      <p class="mt-2 text-sm text-base-content/60">{m.concord_join_body()}</p>
      <button
        class="btn mt-4 btn-neutral"
        onclick={join}
        disabled={phase === 'joining' || concordState.phase !== 'ready'}
      >
        {#if phase === 'joining' || concordState.phase !== 'ready'}
          <span class="loading loading-sm loading-spinner"></span>
        {/if}
        🔒 {m.concord_join_action()}
      </button>
    {/if}
  </div>
</div>
