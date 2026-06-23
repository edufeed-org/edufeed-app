<script>
  // Non-blocking post-login nudge shown when the active user has no kind 10002
  // NIP-65 relay list (or only an empty one) — without one, the outbox model and
  // NIP-17 inbox delivery can't locate them. We only conclude "missing" after the
  // network loader has had time to settle, so this never fires over a list we
  // just hadn't fetched. The copy names the key-signing and is nsec-aware, since
  // private-key accounts get no separate signer prompt.
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { useActiveUser, manager } from '$lib/stores/accounts.svelte';
  import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { createRelayListLoader } from '$lib/loaders/relay-list-loader.js';
  import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
  import { getDefaultRelayList, hasMailboxRelays } from '$lib/helpers/relay-helper.js';
  import { publishDefaultRelayList } from '$lib/services/relay-list-backfill.js';
  import {
    isRelayListBannerDismissed,
    markRelayListBannerDismissed
  } from '$lib/stores/relay-list-flags.svelte.js';
  import { RelayIcon, CloseIcon } from '$lib/components/icons';

  const getActiveUser = useActiveUser();

  // Plain $state: set inside the load/subscribe callbacks below. hasMailboxRelays
  // mutates the event (Symbol cache) so it must not run inside a $derived.
  let hasRelayList = $state(false);
  let settled = $state(false);

  $effect(() => {
    const user = getActiveUser();
    settled = false;
    hasRelayList = false;
    if (!user) return;

    const loader = createRelayListLoader(pool, getRelayListLookupRelays(), eventStore, user.pubkey);
    const loaderSub = loader()().subscribe();
    const sub = eventStore.replaceable(10002, user.pubkey).subscribe((event) => {
      hasRelayList = hasMailboxRelays(event);
    });
    const timeout = setTimeout(() => {
      settled = true;
    }, 5000);

    return () => {
      loaderSub?.unsubscribe();
      sub?.unsubscribe();
      clearTimeout(timeout);
    };
  });

  const isNsec = $derived(getActiveUser()?.type === 'nsec');

  const visible = $derived.by(() => {
    const user = getActiveUser();
    if (!user) return false;
    if (!settled) return false;
    if (hasRelayList) return false;
    // Nothing to recommend → don't prompt (customize-only would be confusing).
    if (getDefaultRelayList().length === 0) return false;
    if (isRelayListBannerDismissed(user.pubkey)) return false;
    return true;
  });

  function handleDismiss() {
    const user = getActiveUser();
    if (!user) return;
    markRelayListBannerDismissed(user.pubkey);
  }

  function handleUseRecommended() {
    // Fire-and-forget: on success the 10002 lands in EventStore, the replaceable
    // subscription flips hasRelayList true, and this banner hides reactively.
    const signer = manager.active?.signer;
    if (signer) publishDefaultRelayList(signer);
  }

  function handleCustomize() {
    goto('/settings#relay-settings');
  }
</script>

{#if visible}
  <div
    data-testid="relay-list-banner"
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
        {m.relay_list_banner_title()}
      </h3>
      <p class="mt-0.5 text-xs leading-snug opacity-80 sm:text-sm">
        {isNsec ? m.relay_list_banner_body_nsec() : m.relay_list_banner_body()}
      </p>
    </div>
    <div class="flex flex-none flex-col gap-1.5 sm:flex-row sm:gap-2">
      <button
        data-testid="relay-list-banner-use"
        class="btn whitespace-nowrap btn-sm btn-primary"
        onclick={handleUseRecommended}
      >
        {m.relay_list_banner_use_cta()}
      </button>
      <button
        data-testid="relay-list-banner-customize"
        class="btn whitespace-nowrap btn-ghost btn-sm"
        onclick={handleCustomize}
      >
        {m.relay_list_banner_customize_cta()}
      </button>
    </div>
    <button
      data-testid="relay-list-banner-dismiss"
      class="btn absolute top-1.5 right-1.5 btn-circle text-info-content/70 btn-ghost btn-xs hover:text-info-content sm:top-2 sm:right-2"
      aria-label={m.relay_list_banner_dismiss()}
      title={m.relay_list_banner_dismiss()}
      onclick={handleDismiss}
    >
      <CloseIcon class_="w-4 h-4" />
    </button>
  </div>
{/if}
