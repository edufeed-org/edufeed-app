<script>
  import { onMount } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { tap, toArray } from 'rxjs';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getTagValue } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { goto } from '$app/navigation';
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: { topic: string } }} */
  let { data } = $props();

  /** @type {'loading' | 'found' | 'multiple' | 'not-found'} */
  let status = $state('loading');

  /** @type {any[]} */
  let results = $state.raw([]);

  onMount(() => {
    const topic = decodeURIComponent(data.topic);
    const relays = getAllLookupRelays();

    const sub = timedPool(relays, [{ kinds: [30818], '#d': [topic] }])
      .pipe(
        tap((event) => eventStore.add(event)),
        toArray()
      )
      .subscribe({
        next: (rawEvents) => {
          // Deduplicate addressable events: keep only newest per pubkey:d-tag
          /** @type {Map<string, any>} */
          // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to callback, not reactive
          const best = new Map();
          for (const event of rawEvents) {
            const key = `${event.pubkey}:${getTagValue(event, 'd') || ''}`;
            const existing = best.get(key);
            if (!existing || event.created_at > existing.created_at) {
              best.set(key, event);
            }
          }
          const found = [...best.values()];

          if (found.length === 1) {
            const event = found[0];
            const naddr = nip19.naddrEncode({
              kind: 30818,
              pubkey: event.pubkey,
              identifier: getTagValue(event, 'd') || '',
              relays: relays.slice(0, 3)
            });
            goto(`/${naddr}`, { replaceState: true });
          } else if (found.length > 1) {
            results = found;
            status = 'multiple';
          } else {
            status = 'not-found';
          }
        },
        error: () => {
          status = 'not-found';
        }
      });

    return () => sub.unsubscribe();
  });

  /**
   * @param {any} event
   * @returns {string}
   */
  function encodeNaddr(event) {
    return nip19.naddrEncode({
      kind: 30818,
      pubkey: event.pubkey,
      identifier: getTagValue(event, 'd') || '',
      relays: getAllLookupRelays().slice(0, 3)
    });
  }
</script>

<svelte:head>
  <title>{decodeURIComponent(data.topic)} - {runtimeConfig.appName}</title>
</svelte:head>

<div class="container mx-auto px-4 py-8">
  {#if status === 'loading'}
    <div class="flex justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
    </div>
  {:else if status === 'not-found'}
    <div class="mx-auto max-w-2xl py-16 text-center">
      <h1 class="mb-4 text-3xl font-bold text-base-content">{m.route_article_not_found()}</h1>
      <p class="text-base-content/70">
        {m.route_article_not_found_detail({ topic: decodeURIComponent(data.topic) })}
      </p>
    </div>
  {:else if status === 'multiple'}
    <div class="mx-auto max-w-2xl">
      <h1 class="mb-6 text-3xl font-bold text-base-content">
        {decodeURIComponent(data.topic)}
      </h1>
      <p class="mb-6 text-base-content/70">{m.route_article_multiple()}</p>
      <div class="flex flex-col gap-3">
        {#each results as event (event.id)}
          {@const title = getTagValue(event, 'title') || getTagValue(event, 'd') || 'Untitled'}
          <a
            href="/{encodeNaddr(event)}"
            class="card bg-base-100 transition-shadow hover:shadow-md"
          >
            <div class="card-body p-4">
              <h2 class="card-title text-lg">{title}</h2>
              <div class="flex items-center gap-2 text-sm text-base-content/60">
                <ProfileCard
                  pubkey={event.pubkey}
                  size="sm"
                  showNpub={false}
                  showIcon={false}
                  linkToProfile={false}
                  class="bg-transparent p-0"
                />
                <span>&middot;</span>
                <span>{formatCalendarDate(new Date(event.created_at * 1000), 'default')}</span>
              </div>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/if}
</div>
