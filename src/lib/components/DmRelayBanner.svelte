<script>
  // Non-blocking post-login nudge shown when the DM-relay self-check concludes
  // the active user has no kind 10050 DM relay list — so reports/DMs sent to
  // them can't be reliably delivered. The check (in dm-service) only reports
  // 'absent' after querying the user's own outbox + identity indexers and
  // giving them time, so this never fires over a list we just hadn't fetched.
  //
  // "Use recommended" publishes the default list via ensureDmRelayList, which
  // re-checks getReplaceable(10050) first — so even a list that lands between
  // the check settling and the click won't be clobbered.
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { getDmRelayCheckStatus } from '$lib/services/dm-service.svelte.js';
  import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';
  import { getDefaultDmRelays } from '$lib/helpers/relay-helper.js';
  import {
    isDmRelayBannerDismissed,
    markDmRelayBannerDismissed
  } from '$lib/stores/dm-relay-flags.svelte.js';
  import { RelayIcon, CloseIcon } from '$lib/components/icons';

  const getActiveUser = useActiveUser();

  const visible = $derived.by(() => {
    const user = getActiveUser();
    if (!user) return false;
    if (getDmRelayCheckStatus() !== 'absent') return false;
    // Nothing to recommend → don't prompt (customize-only would be confusing).
    if (getDefaultDmRelays().length === 0) return false;
    if (isDmRelayBannerDismissed(user.pubkey)) return false;
    return true;
  });

  function handleDismiss() {
    const user = getActiveUser();
    if (!user) return;
    markDmRelayBannerDismissed(user.pubkey);
  }

  function handleUseRecommended() {
    // Fire-and-forget: on success the dm-service kind 10050 watch flips the
    // check status to 'present', which hides this banner reactively.
    ensureDmRelayList();
  }

  function handleCustomize() {
    goto('/settings#dm-relay-settings');
  }
</script>

{#if visible}
  <div
    data-testid="dm-relay-banner"
    role="status"
    class="relative mx-auto flex w-full max-w-4xl items-center gap-3 rounded-lg border border-info/40 bg-info/15 p-3 pr-10 text-info-content/90 shadow-sm sm:gap-4 sm:p-4 sm:pr-12"
  >
    <div
      class="hidden h-10 w-10 flex-none items-center justify-center rounded-full bg-info/30 text-info-content sm:flex"
      aria-hidden="true"
    >
      <RelayIcon class_="w-5 h-5" />
    </div>
    <div class="min-w-0 flex-1">
      <h3 class="text-sm leading-tight font-semibold sm:text-base">
        {m.dm_relay_banner_title()}
      </h3>
      <p class="mt-0.5 text-xs leading-snug opacity-80 sm:text-sm">
        {m.dm_relay_banner_body()}
      </p>
    </div>
    <div class="flex flex-none flex-col gap-1.5 sm:flex-row sm:gap-2">
      <button
        data-testid="dm-relay-banner-use"
        class="btn whitespace-nowrap btn-sm btn-primary"
        onclick={handleUseRecommended}
      >
        {m.dm_relay_banner_use_cta()}
      </button>
      <button
        data-testid="dm-relay-banner-customize"
        class="btn whitespace-nowrap btn-ghost btn-sm"
        onclick={handleCustomize}
      >
        {m.dm_relay_banner_customize_cta()}
      </button>
    </div>
    <button
      data-testid="dm-relay-banner-dismiss"
      class="btn absolute top-1.5 right-1.5 btn-circle text-info-content/70 btn-ghost btn-xs hover:text-info-content sm:top-2 sm:right-2"
      aria-label={m.dm_relay_banner_dismiss()}
      title={m.dm_relay_banner_dismiss()}
      onclick={handleDismiss}
    >
      <CloseIcon class_="w-4 h-4" />
    </button>
  </div>
{/if}
