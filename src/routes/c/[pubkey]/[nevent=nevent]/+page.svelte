<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import { npubToHex } from '$lib/helpers/nostrUtils';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: any }} */
  let { data } = $props();

  // Convert community npub from URL to hex for #h tags on comments
  const communityPubkey = $derived(
    $page.params.pubkey ? (npubToHex($page.params.pubkey) ?? undefined) : undefined
  );

  function handleBack() {
    goto(resolve(`/c/${$page.data.npub}?view=forum`));
  }
</script>

{#if data.event?.kind === 11 || data.event?.kind === 1}
  <!-- Thread detail within community layout -->
  <div class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-[304px] lg:pb-0">
    <div class="p-4">
      <button class="btn mb-4 gap-1 btn-ghost btn-sm" onclick={handleBack}>
        <ChevronLeftIcon class_="w-4 h-4" />
        {m.thread_forum_back_to_list()}
      </button>
      <ThreadDetailView
        event={data.event}
        parentEvent={data.parentEvent}
        onBack={handleBack}
        initialFocusCommentId={data.focusCommentId}
        scrollTo={data.scrollTo}
        {communityPubkey}
      />
    </div>
  </div>
{:else}
  <!-- Unsupported content type -->
  <div class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-[304px] lg:pb-0">
    <div class="flex h-full flex-col items-center justify-center p-8 text-center">
      <p class="text-base-content/60">Unsupported content type (kind {data.event?.kind})</p>
    </div>
  </div>
{/if}
