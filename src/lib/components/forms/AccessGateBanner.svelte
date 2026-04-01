<script>
  import { nip19 } from 'nostr-tools';
  import { page } from '$app/stores';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { timedPool } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { buildUserResponseFilter } from '$lib/helpers/forms.js';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';

  let { formRef, sectionName, userPubkey } = $props();

  let hasExistingResponse = $state(false);

  let naddr = $derived.by(() => {
    if (!formRef) return null;
    const parts = formRef.split(':');
    if (parts.length < 3) return null;
    const [kindStr, pubkey, ...identifierParts] = parts;
    const kind = parseInt(kindStr, 10);
    const identifier = identifierParts.join(':');
    try {
      return nip19.naddrEncode({ kind, pubkey, identifier, relays: [] });
    } catch {
      return null;
    }
  });

  let applyHref = $derived.by(() => {
    if (!naddr) return null;
    const returnTo = encodeURIComponent($page.url.pathname);
    return `/forms/${naddr}/respond?returnTo=${returnTo}`;
  });

  // Check if user already submitted a response
  $effect(() => {
    if (!formRef || !userPubkey) return;

    const filter = buildUserResponseFilter(formRef, userPubkey);
    const relays = getCommunikeyRelays();

    const loaderSub = createTimelineLoader(timedPool, relays, filter, {
      eventStore,
      limit: 1
    })().subscribe();

    const modelSub = eventStore.timeline(filter).subscribe((events) => {
      if (events && events.length > 0) {
        hasExistingResponse = true;
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });
</script>

{#if naddr}
  <div class="mb-4 alert {hasExistingResponse ? 'alert-warning' : 'alert-info'}">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      class="h-6 w-6 shrink-0 stroke-current"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
    {#if hasExistingResponse}
      <div>
        <p class="font-medium">Application submitted</p>
        <p class="text-sm opacity-80">
          Your application for {sectionName} is pending review.
        </p>
      </div>
    {:else}
      <div>
        <p class="font-medium">This section requires approval</p>
        <p class="text-sm opacity-80">
          Fill out the application form to request access to {sectionName}.
        </p>
      </div>
      <a href={applyHref} class="btn btn-sm btn-primary">Apply</a>
    {/if}
  </div>
{/if}
