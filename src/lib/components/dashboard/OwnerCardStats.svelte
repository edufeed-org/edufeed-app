<!--
  OwnerCardStats — lazy like/share counts for a "Meine Inhalte" item.

  Self-observes via IntersectionObserver so counts are only fetched once the
  card scrolls into view. Likes = NIP-25 reactions (kind 7); shares = NIP-18
  reposts (kind 6/16) referencing the event by id or addressable coordinate.
  Renders nothing until there is at least one like or share (mirrors the
  prototype's "hide stats when there is no engagement" behaviour).
-->
<script>
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { reactionsLoader } from '$lib/loaders/reactions.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

  /** @type {{ event: any }} */
  let { event } = $props();

  let likeCount = $state(0);
  let shareCount = $state(0);

  /** @type {HTMLSpanElement | undefined} */
  let anchorEl = $state(undefined);

  // Pure addressable coordinate — avoids getReplaceableAddress() which caches
  // internally and triggers state_unsafe_mutation in reactive contexts.
  /** @param {any} ev */
  function addressOf(ev) {
    if (!ev || ev.kind < 30000 || ev.kind >= 40000) return undefined;
    const d = ev.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    return `${ev.kind}:${ev.pubkey}:${d}`;
  }

  $effect(() => {
    if (!event?.id || !anchorEl) return;

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();

        const relays = getAllLookupRelays();

        // Likes — reactive, deletion-aware model + network fetch.
        subs.push(
          eventStore.reactions(event).subscribe((rx) => {
            likeCount = (rx || []).length;
          })
        );
        subs.push(reactionsLoader(event, relays).subscribe({ error: () => {} }));

        // Shares — reposts referencing this event by id (#e) or coordinate (#a).
        /** @type {import('nostr-tools').Filter[]} */
        const filters = [{ kinds: [6, 16], '#e': [event.id] }];
        const addr = addressOf(event);
        if (addr) filters.push({ kinds: [6, 16], '#a': [addr] });

        const shareLoader = createTimelineLoader(timedPool, relays, filters, { eventStore });
        subs.push(shareLoader().subscribe({ error: () => {} }));
        subs.push(
          eventStore.model(TimelineModel, filters).subscribe((list) => {
            shareCount = (list || []).length;
          })
        );
      },
      { rootMargin: '200px', threshold: 0.01 }
    );
    observer.observe(anchorEl);

    return () => {
      observer.disconnect();
      subs.forEach((s) => s.unsubscribe());
    };
  });

  let hasStats = $derived(likeCount > 0 || shareCount > 0);
</script>

<span bind:this={anchorEl} class="ocs">
  {#if hasStats}<span class="ocs-sep" aria-hidden="true">·</span>{/if}
  {#if likeCount > 0}
    <span class="ocs-stat" title="Reaktionen">
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        />
      </svg>
      {likeCount}
    </span>
  {/if}
  {#if shareCount > 0}
    <span class="ocs-stat" title="Geteilt">
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15"
        />
      </svg>
      {shareCount}
    </span>
  {/if}
</span>

<style>
  .ocs {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .ocs-stat {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-variant-numeric: tabular-nums;
  }
  .ocs-sep {
    opacity: 0.5;
  }
</style>
