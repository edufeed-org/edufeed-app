<script>
  /**
   * "Official" chip next to a platform account's name. Renders nothing for
   * everyone else, so callers can drop it beside any sender name without a
   * guard. See official-accounts.js for who qualifies.
   */
  import { isOfficialPubkey } from '$lib/helpers/official-accounts.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string | undefined, class_?: string }} */
  let { pubkey, class_ = '' } = $props();

  const official = $derived(isOfficialPubkey(pubkey));
</script>

{#if official}
  <span
    class="badge shrink-0 badge-xs badge-primary {class_}"
    title={m.official_badge_title({ appName: runtimeConfig.appName })}
  >
    {m.official_badge_label()}
  </span>
{/if}
