<script>
  import { reactionsLoader } from '$lib/loaders/reactions.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishWave, canWave, isWave } from '$lib/helpers/waves.js';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages.js';

  /** @type {{ profileEvent: any, pubkey: string }} */
  let { profileEvent, pubkey } = $props();

  let loading = $state(false);
  /** @type {any[]} */
  let reactions = $state.raw([]);

  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSub;

  $effect(() => {
    if (!profileEvent?.id) return;

    loaderSub = reactionsLoader(profileEvent).subscribe();

    modelSub = eventStore.reactions(profileEvent).subscribe((reactionEvents) => {
      const waves = (reactionEvents || []).filter((/** @type {any} */ e) => isWave(e));
      reactions = waves;
    });

    return () => {
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  let cooldownState = $derived(canWave(reactions, pubkey));

  async function handleWave() {
    if (loading || !cooldownState.canWave || !profileEvent) return;
    loading = true;
    try {
      await publishWave(profileEvent);
      showToast(m.wave_success(), 'success');
    } catch (err) {
      console.error('Failed to wave:', err);
      showToast(m.wave_error(), 'error');
    } finally {
      loading = false;
    }
  }
</script>

<button
  class="btn btn-circle btn-ghost btn-sm"
  onclick={handleWave}
  disabled={loading || !cooldownState.canWave}
  title={cooldownState.canWave ? m.wave_button_tooltip() : m.wave_cooldown_tooltip()}
>
  {#if loading}
    <span class="loading loading-xs loading-spinner"></span>
  {:else}
    <span class="text-lg">👋</span>
  {/if}
</button>
