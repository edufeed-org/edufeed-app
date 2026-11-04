<script>
  import { reactionsLoader } from '$lib/loaders/reactions.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishWave, canWave, isWave } from '$lib/helpers/waves.js';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages.js';

  /** @type {{ profileEvent: any, pubkey: string, variant?: 'circle' | 'header' }} */
  /** `variant: 'header'` renders the profile header's 46px square (matches its
   *  sibling buttons there) instead of the DaisyUI icon circle. */
  let { profileEvent, pubkey, variant = 'circle' } = $props();

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

  /** @param {MouseEvent} e */
  function handleWave(e) {
    e.stopPropagation();
    e.preventDefault();
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

{#if variant === 'header'}
  <button
    class="wave-header"
    class:done={waved || !cooldownState.canWave}
    onclick={handleWave}
    disabled={!cooldownState.canWave}
    title={cooldownState.canWave ? m.wave_button_tooltip() : m.wave_cooldown_tooltip()}
    aria-label={cooldownState.canWave ? m.wave_button_tooltip() : m.wave_cooldown_tooltip()}
  >
    <span class="text-lg">👋</span>
  </button>
{:else}
  <button
    class="btn btn-circle transition-colors btn-sm
      {waved || !cooldownState.canWave ? 'btn-success' : 'btn-ghost'}"
    onclick={handleWave}
    disabled={!cooldownState.canWave}
    title={cooldownState.canWave ? m.wave_button_tooltip() : m.wave_cooldown_tooltip()}
  >
    <span class="text-lg">👋</span>
  </button>
{/if}

<style>
  /* Same metrics as ProfileHeader's .pf-btn.ghost.icon (46px, 10px radius,
     paper + rule ring) so the header row reads as one set of squares. */
  .wave-header {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    border-radius: 10px;
    border: 0;
    cursor: pointer;
    background: var(--c-paper);
    color: var(--c-ink);
    box-shadow: inset 0 0 0 1.5px var(--c-rule);
    transition: background 0.15s;
  }
  .wave-header:hover {
    background: var(--c-bg);
  }
  .wave-header.done {
    background: var(--c-band);
    cursor: default;
  }
</style>
