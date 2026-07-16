<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import {
    startRecovery,
    recoverShard,
    aggregateNsec,
    PomegranatePubkeyMismatchError
  } from '$lib/services/pomegranate.js';

  let activeAccount = $state(/** @type {any} */ (null));
  $effect(() => {
    const sub = manager.active$.subscribe((account) => {
      activeAccount = account;
      // Reset any in-progress recovery when the account switches.
      recovery = null;
      shards = [];
      nsec = '';
      errorMessage = '';
    });
    return () => sub.unsubscribe();
  });

  const central = $derived(activeAccount?.metadata?.pomegranateCentral || '');

  /** @type {{ token: any, account: import('$lib/services/pomegranate.js').PomegranateAccount } | null} */
  let recovery = $state.raw(null);
  /** @type {string[]} */
  let shards = $state.raw([]);
  let nsec = $state('');
  let errorMessage = $state('');
  let busy = $state(false);
  let copied = $state(false);

  /** Each recover step opens ONE popup (user gesture per operator). */
  async function step() {
    errorMessage = '';
    busy = true;
    try {
      if (!recovery) {
        recovery = await startRecovery(central, activeAccount.pubkey);
        busy = false;
        return;
      }
      const operator = recovery.account.operators[shards.length];
      const shard = await recoverShard(operator);
      shards = [...shards, shard];
      if (shards.length >= recovery.account.threshold) {
        nsec = aggregateNsec(shards, activeAccount.pubkey);
      }
    } catch (err) {
      errorMessage =
        err instanceof PomegranatePubkeyMismatchError
          ? m.settings_pomegranate_error_mismatch()
          : /** @type {Error} */ (err)?.message || String(err);
    } finally {
      busy = false;
    }
  }

  async function copyNsec() {
    try {
      await navigator.clipboard.writeText(nsec);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }
</script>

{#if central}
  <div class="card mt-6 bg-base-100 shadow-xl" data-testid="pomegranate-export-card">
    <div class="card-body">
      <h2 class="mb-2 card-title text-2xl">{m.settings_pomegranate_title()}</h2>
      <p class="mb-6 text-base-content/70">{m.settings_pomegranate_description()}</p>

      {#if errorMessage}
        <div class="alert alert-error"><span class="text-sm">{errorMessage}</span></div>
      {/if}

      {#if nsec}
        <div class="flex items-center gap-2">
          <input
            class="input-bordered input w-full font-mono text-xs"
            readonly
            value={nsec}
            data-testid="pomegranate-nsec"
          />
          <button class="btn btn-sm" onclick={copyNsec}>
            {copied ? m.settings_pomegranate_copied() : m.settings_pomegranate_copy()}
          </button>
        </div>
      {:else}
        <button
          class="btn w-fit btn-outline"
          data-testid="pomegranate-export-step"
          disabled={busy}
          onclick={step}
        >
          {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
          {#if !recovery}
            {m.settings_pomegranate_export_button()}
          {:else}
            {m.settings_pomegranate_next_shard({
              current: shards.length + 1,
              needed: recovery.account.threshold
            })}
          {/if}
        </button>
      {/if}
    </div>
  </div>
{/if}
