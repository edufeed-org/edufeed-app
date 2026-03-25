<!--
  ProfileContentView — Generic author-filtered content view component.
  Handles loading/empty/error/content states for any content type on a profile page.
  Modeled after CommunityContentView but uses author-based filtering.
-->

<script>
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pubkey: string,
   *   kinds: number[],
   *   getRelays: () => string[],
   *   emptyTitle?: string,
   *   emptyDescription?: string,
   *   emptyIconPath?: string,
   *   content: import('svelte').Snippet<[any[], Map<string, any>]>
   * }}
   */
  let {
    pubkey,
    kinds,
    getRelays,
    emptyTitle = '',
    emptyDescription = '',
    emptyIconPath = 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
    content
  } = $props();

  let items = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let error = $state(/** @type {string | null} */ (null));

  const getAuthorProfiles = useProfileMap(() => items.map((i) => i.pubkey));
  let authorProfiles = $derived(getAuthorProfiles());

  $effect(() => {
    items = [];
    isLoading = true;
    error = null;

    const relays = getRelays();
    if (!pubkey || relays.length === 0) {
      isLoading = false;
      return;
    }

    try {
      const filter = { kinds, authors: [pubkey], limit: 50 };
      const loader = createTimelineLoader(timedPool, relays, filter, { eventStore });
      const loaderSub = loader().subscribe({
        error: (err) => {
          console.error('ProfileContentView: Loader error:', err);
          error = m.profile_content_error();
          isLoading = false;
        }
      });

      // Supplemental loader: fetch from viewed user's NIP-65 write relays
      /** @type {import('rxjs').Subscription | undefined} */
      let writeRelaySub;
      const initialRelays = new Set(relays);
      getWriteRelays(pubkey).then((writeRelays) => {
        const newRelays = writeRelays.filter((r) => !initialRelays.has(r));
        if (newRelays.length === 0) return;
        const supplementalLoader = createTimelineLoader(timedPool, newRelays, filter, {
          eventStore
        });
        writeRelaySub = supplementalLoader().subscribe({
          error: (err) => console.error('ProfileContentView: Write relay loader error:', err)
        });
      });

      const modelSub = eventStore.model(TimelineModel, { kinds, authors: [pubkey] }).subscribe({
        next: (loaded) => {
          items = loaded || [];
          isLoading = false;
        },
        error: (err) => {
          console.error('ProfileContentView: Model error:', err);
          error = m.profile_content_error();
          isLoading = false;
        }
      });

      return () => {
        loaderSub.unsubscribe();
        writeRelaySub?.unsubscribe();
        modelSub.unsubscribe();
      };
    } catch (err) {
      console.error('ProfileContentView: Setup error:', err);
      error = m.profile_content_error();
      isLoading = false;
    }
  });
</script>

<div class="py-4">
  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-base-content/60">{m.profile_content_loading()}</p>
    </div>
  {:else if error}
    <div class="alert alert-error">
      <span>{error}</span>
    </div>
  {:else if items.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-200">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12 text-base-content/40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={emptyIconPath} />
        </svg>
      </div>
      <h3 class="mb-2 text-lg font-semibold text-base-content">{emptyTitle}</h3>
      <p class="max-w-md text-base-content/60">{emptyDescription}</p>
    </div>
  {:else}
    {@render content(items, authorProfiles)}
  {/if}
</div>
