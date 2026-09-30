<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { runtimeConfig, configReady } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { parseConnectHash } from '$lib/agents/pairing.js';
  import { pairWithCompanion } from '$lib/agents/pairing.svelte.js';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();
  const request = parseConnectHash(typeof window === 'undefined' ? '' : window.location.hash);

  /** @type {'idle' | 'pairing' | 'done' | 'error'} */
  let phase = $state('idle');
  let errorText = $state('');
  let askedLogin = false;

  // Logged out: open the login modal once and keep the request in the hash;
  // the page continues as soon as an account becomes active.
  $effect(() => {
    const user = getActiveUser();
    if (!user && !askedLogin && request.ok) {
      askedLogin = true;
      modalStore.openModal('login');
    }
  });

  async function connect() {
    if (!request.ok) return;
    phase = 'pairing';
    try {
      const agentPubkey = await pairWithCompanion(request);
      phase = 'done';
      await goto(resolve(/** @type {any} */ ('/c/agents/new')) + '?agent=' + agentPubkey);
    } catch (error) {
      phase = 'error';
      errorText = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<svelte:head><title>{m.agents_connect_title()}</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-10">
  {#if $configReady && !runtimeConfig.agents?.enabled}
    <p class="text-base-content/70">{m.agents_disabled()}</p>
  {:else if !request.ok}
    <h1 class="mb-2 text-xl font-semibold">{m.agents_connect_title()}</h1>
    <p class="text-error">
      {#if request.error === 'missing'}{m.agents_connect_error_missing()}
      {:else if request.error === 'no-secret'}{m.agents_connect_error_no_secret()}
      {:else}{m.agents_connect_error_invalid()}{/if}
    </p>
  {:else if !getActiveUser()}
    <h1 class="mb-2 text-xl font-semibold">{m.agents_connect_title()}</h1>
    <p>{m.agents_connect_login_first()}</p>
    <button type="button" class="btn mt-4 btn-primary" onclick={() => modalStore.openModal('login')}
      >{m.agents_connect_login_button()}</button
    >
  {:else}
    <h1 class="mb-2 text-xl font-semibold">{m.agents_connect_title()}</h1>
    <p class="mb-6">
      {m.agents_connect_question({ name: request.name || m.agents_connect_default_name() })}
    </p>
    {#if phase === 'error'}
      <p class="mb-4 text-error">{m.agents_connect_failed({ reason: errorText })}</p>
    {/if}
    <div class="flex gap-2">
      <a href={resolve(/** @type {any} */ ('/c/agents'))} class="btn btn-ghost"
        >{m.agents_connect_cancel()}</a
      >
      <button
        type="button"
        class="btn btn-primary"
        onclick={connect}
        disabled={phase === 'pairing' || phase === 'done'}
      >
        {#if phase === 'pairing'}<span class="loading loading-sm loading-spinner"></span>{/if}
        {m.agents_connect_confirm()}
      </button>
    </div>
  {/if}
</div>
