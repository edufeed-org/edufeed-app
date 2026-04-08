<script>
  import { page } from '$app/stores';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import { npubToHex } from '$lib/helpers/nostrUtils';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { getHasHistory } from '$lib/helpers/navigationHistory.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: any }} */
  let { data } = $props();

  // Convert community npub from URL to hex for #h tags on comments
  const communityPubkey = $derived(
    $page.params.pubkey ? (npubToHex($page.params.pubkey) ?? undefined) : undefined
  );
</script>

{#if data.event?.kind === 11 || data.event?.kind === 1}
  <!-- Thread detail within community layout -->
  <div
    class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-(--sidebar-nav-w) lg:pb-0"
  >
    <div class="p-4">
      <button
        onclick={() => {
          if (getHasHistory()) history.back();
        }}
        class="btn mb-2 btn-circle btn-ghost btn-sm"
        aria-label={m.common_back()}
      >
        <ChevronLeftIcon class_="w-5 h-5" />
      </button>
      <ThreadDetailView
        event={data.event}
        parentEvent={data.parentEvent}
        initialFocusCommentId={data.focusCommentId}
        scrollTo={data.scrollTo}
        {communityPubkey}
      />
    </div>
  </div>
{:else}
  <!-- Unsupported content type -->
  <div
    class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-(--sidebar-nav-w) lg:pb-0"
  >
    <div class="flex h-full flex-col items-center justify-center p-8 text-center">
      <p class="text-base-content/60">Unsupported content type (kind {data.event?.kind})</p>
    </div>
  </div>
{/if}
