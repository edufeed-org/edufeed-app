<script>
  import { goto } from '$app/navigation';
  // Owner-only nudge for legacy kind 10222 definitions that predate the
  // ["strict", "content"] marker. Those fail open (all tabs visible), so the
  // owner should re-save their content-type settings once — the edit modal
  // pre-enables everything and writes the marker, activating tab filtering.
  // The banner keys off the event itself, so it disappears for good (on every
  // device) as soon as the re-saved definition arrives.
  import * as m from '$lib/paraglide/messages';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { hasStrictContentMarker } from '$lib/helpers/communityRelays.js';
  import {
    isLegacyContentBannerDismissed,
    markLegacyContentBannerDismissed
  } from '$lib/stores/legacy-content-banner-flags.svelte.js';
  import { CloseIcon, SettingsIcon } from '$lib/components/icons';

  /** @type {{ communityEvent: any }} */
  let { communityEvent } = $props();

  const getActiveUser = useActiveUser();

  const visible = $derived.by(() => {
    if (!communityEvent) return false;
    if (hasStrictContentMarker(communityEvent)) return false;
    const user = getActiveUser();
    if (!user || user.pubkey !== communityEvent.pubkey) return false;
    if (isLegacyContentBannerDismissed(communityEvent.pubkey)) return false;
    return true;
  });

  function handleReview() {
    // The edit modal is retired — the settings page's inline basics form is
    // the review surface now (settings redesign, laoc 2026-08-18).
    goto('?view=settings');
  }

  function handleDismiss() {
    markLegacyContentBannerDismissed(communityEvent.pubkey);
  }
</script>

{#if visible}
  <div
    data-testid="legacy-content-banner"
    role="status"
    class="relative mx-auto flex w-full max-w-4xl items-center gap-3 rounded-lg border border-info/40 bg-info/15 p-3 pr-10 text-info-content/90 shadow-sm sm:gap-4 sm:p-4 sm:pr-12"
  >
    <div
      class="hidden h-10 w-10 flex-none items-center justify-center rounded-full bg-info/30 text-info-content sm:flex"
      aria-hidden="true"
    >
      <SettingsIcon class_="w-5 h-5" />
    </div>
    <div class="min-w-0 flex-1">
      <h3 class="text-sm leading-tight font-semibold sm:text-base">
        {m.community_legacy_content_banner_title()}
      </h3>
      <p class="mt-0.5 text-xs leading-snug opacity-80 sm:text-sm">
        {m.community_legacy_content_banner_text()}
      </p>
    </div>
    <button
      data-testid="legacy-content-banner-review"
      class="btn flex-none whitespace-nowrap btn-sm btn-primary"
      onclick={handleReview}
    >
      {m.community_legacy_content_banner_review()}
    </button>
    <button
      data-testid="legacy-content-banner-dismiss"
      class="btn absolute top-1.5 right-1.5 btn-circle text-info-content/70 btn-ghost btn-xs hover:text-info-content sm:top-2 sm:right-2"
      aria-label={m.community_legacy_content_banner_dismiss()}
      title={m.community_legacy_content_banner_dismiss()}
      onclick={handleDismiss}
    >
      <CloseIcon class_="w-4 h-4" />
    </button>
  </div>
{/if}
