<script>
  import { page } from '$app/stores';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import { npubToHex } from '$lib/helpers/nostrUtils';

  /** @type {{ data: any }} */
  let { data } = $props();

  // Convert community npub from URL to hex for #h tags on comments
  const communityPubkey = $derived(
    $page.params.pubkey ? (npubToHex($page.params.pubkey) ?? undefined) : undefined
  );
</script>

{#if data.event?.kind === 11 || data.event?.kind === 1 || data.event?.kind === 1111}
  <div
    class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-(--sidebar-nav-w) lg:pb-0"
  >
    <div class="p-4">
      <ThreadDetailView
        event={data.event}
        parentPointer={data.parentPointer}
        initialFocusCommentId={data.focusCommentId}
        scrollTo={data.scrollTo}
        {communityPubkey}
      />
    </div>
  </div>
{:else}
  <div
    class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-(--sidebar-nav-w) lg:pb-0"
  >
    <div class="flex h-full flex-col items-center justify-center p-8 text-center">
      <p class="text-base-content/60">Unsupported content type (kind {data.event?.kind})</p>
    </div>
  </div>
{/if}
