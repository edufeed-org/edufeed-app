<script>
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import {
    AddDirectMessageRelay,
    RemoveDirectMessageRelay,
    NewDirectMessageRelays
  } from 'applesauce-actions/actions';
  import { getDmRelays } from '$lib/services/dm-service.svelte.js';
  import { TrashIcon, PlusIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  let newRelayUrl = $state('');
  let error = $state('');
  let saving = $state(false);

  let relays = $derived(getDmRelays());

  async function addRelay() {
    error = '';
    const url = newRelayUrl.trim();
    if (!url) return;

    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      error = 'Relay URL must start with wss:// or ws://';
      return;
    }

    saving = true;
    try {
      if (relays.length === 0) {
        // Create new DM relay list
        await actionRunner.run(NewDirectMessageRelays, [url]);
      } else {
        await actionRunner.run(AddDirectMessageRelay, url);
      }
      newRelayUrl = '';
    } catch (err) {
      console.error('Failed to add DM relay:', err);
      error = err instanceof Error ? err.message : 'Failed to add relay';
    } finally {
      saving = false;
    }
  }

  /** @param {string} url */
  async function removeRelay(url) {
    saving = true;
    try {
      await actionRunner.run(RemoveDirectMessageRelay, url);
    } catch (err) {
      console.error('Failed to remove DM relay:', err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-4">
  <div>
    <h3 class="text-lg font-bold">{m.dm_relay_settings_title()}</h3>
    <p class="text-sm text-base-content/60">{m.dm_relay_settings_description()}</p>
  </div>

  <!-- Current relays -->
  {#if relays.length > 0}
    <div class="space-y-2">
      {#each relays as relay (relay)}
        <div class="flex items-center justify-between rounded-lg bg-base-200 px-3 py-2">
          <code class="text-sm">{relay}</code>
          <button
            class="btn text-error btn-ghost btn-xs"
            onclick={() => removeRelay(relay)}
            disabled={saving}
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="rounded-lg bg-base-200 px-4 py-3 text-sm text-base-content/60">
      {m.dm_no_relays_title()}
    </div>
  {/if}

  <!-- Add relay -->
  <div class="flex gap-2">
    <input
      type="text"
      bind:value={newRelayUrl}
      placeholder={m.dm_relay_placeholder()}
      class="input-bordered input input-sm flex-1"
      disabled={saving}
    />
    <button
      class="btn btn-sm btn-primary"
      onclick={addRelay}
      disabled={saving || !newRelayUrl.trim()}
    >
      {#if saving}
        <span class="loading loading-xs loading-spinner"></span>
      {:else}
        <PlusIcon class_="h-4 w-4" />
      {/if}
      {m.dm_relay_add()}
    </button>
  </div>

  {#if error}
    <p class="text-sm text-error">{error}</p>
  {/if}
</div>
