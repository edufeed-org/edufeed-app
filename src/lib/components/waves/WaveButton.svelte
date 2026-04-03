<script>
  import { reactionsLoader } from '$lib/loaders/reactions.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishWave, canWave, isWave } from '$lib/helpers/waves.js';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages.js';

  /** @type {{ profileEvent: any, pubkey: string }} */
  let { profileEvent, pubkey } = $props();

  /** @type {any[]} */
  let reactions = $state.raw([]);
  let waved = $state(false);

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
      waved = false;
    };
  });

  let cooldownState = $derived(canWave(reactions, pubkey));

  function handleWave() {
    if (!cooldownState.canWave || !profileEvent) return;
    waved = true;
    publishWave(profileEvent)
      .then(() => showToast(m.wave_success(), 'success'))
      .catch((err) => {
        console.error('Failed to wave:', err);
        waved = false;
        showToast(m.wave_error(), 'error');
      });
  }
</script>

<button
  class="btn btn-circle transition-colors btn-sm
    {waved || !cooldownState.canWave ? 'text-white btn-success' : 'btn-ghost'}"
  onclick={handleWave}
  disabled={!cooldownState.canWave}
  title={cooldownState.canWave ? m.wave_button_tooltip() : m.wave_cooldown_tooltip()}
>
  <span class="text-lg">👋</span>
</button>
