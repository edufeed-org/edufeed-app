<!--
  PublisherOfferBanner — the member's CONSENT step of the publisher window
  (spec: docs/nips/communikey-groups.md "Publisher window"). Shown when the
  owner granted the active user the Publisher role and no consent rumor
  exists yet. Accepting is the explicit self-disclosure moment: it states
  plainly that the member becomes publicly visible. Declining sends a
  'revoked' consent so the offer stops nagging (the owner sees the decline).

  Concord submodules imported DIRECTLY (never the barrel) — the convention
  every Concord component follows (see CLAUDE.md's Concord section).
-->
<script>
  import {
    usePublisherWindow,
    sendPublisherConsent
  } from '$lib/concord/publisher-window.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent } = $props();

  const getWindow = usePublisherWindow(() => communikeyEvent);
  let busy = $state(false);

  /** @param {'accepted' | 'revoked'} status */
  async function respond(status) {
    const window = getWindow();
    if (busy || !window.community) return;
    busy = true;
    try {
      await sendPublisherConsent(window.community, status);
      showToast(
        status === 'accepted' ? m.publisher_consent_accepted() : m.publisher_consent_declined(),
        'success'
      );
    } catch (error) {
      console.error('publisher: consent failed', error);
      showToast(m.publisher_action_failed(), 'error');
    } finally {
      busy = false;
    }
  }
</script>

{#if getWindow().myState === 'offered'}
  <div
    class="mx-4 mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
    data-testid="publisher-offer-banner"
  >
    <p class="text-sm font-semibold">🪟 {m.publisher_banner_title()}</p>
    <p class="mt-1 text-sm text-base-content/70">{m.publisher_banner_body()}</p>
    <div class="mt-3 flex gap-2">
      <button class="btn btn-sm btn-primary" disabled={busy} onclick={() => respond('accepted')}>
        {m.publisher_accept()}
      </button>
      <button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => respond('revoked')}>
        {m.publisher_decline()}
      </button>
    </div>
  </div>
{/if}
