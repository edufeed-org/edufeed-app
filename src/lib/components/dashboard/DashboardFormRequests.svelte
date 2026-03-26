<!--
  DashboardFormRequests — Shows form requests (kind 1070) sent to the logged-in user.
  Loads form templates and sender profiles, tracks response status.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { SvelteSet } from 'svelte/reactivity';
  import { TimelineModel } from 'applesauce-core/models';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { formRequestLoader } from '$lib/loaders/community.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    FORM_REQUEST_KIND,
    getFormRequestFormAddress,
    parseFormRequestMessage,
    formCoordinateToNaddr
  } from '$lib/helpers/forms.js';
  import { ScrollTextIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string }} */
  let { pubkey } = $props();

  /** @type {import('nostr-tools').NostrEvent[]} */
  let requests = $state.raw([]);
  let isLoading = $state(true);

  /** @type {Map<string, import('nostr-tools').NostrEvent>} form address -> form template event */
  let formTemplates = $state.raw(new Map());

  /** @type {Set<string>} form addresses that user has responded to */
  let respondedForms = $state.raw(new Set());

  /** @type {Map<string, string>} event id -> decrypted message */
  let decryptedMessages = $state.raw(new Map());

  // Load form requests for this user
  $effect(() => {
    if (!pubkey) {
      isLoading = false;
      return;
    }

    const loader = formRequestLoader(pubkey);
    const loaderSub = loader().subscribe();

    const modelSub = eventStore
      .model(TimelineModel, { kinds: [FORM_REQUEST_KIND] })
      .subscribe((events) => {
        const filtered = (events || []).filter((e) =>
          e.tags.some((t) => t[0] === 'p' && t[1] === pubkey)
        );
        requests = filtered;
        isLoading = false;
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Load form templates for each request
  $effect(() => {
    if (requests.length === 0) return;

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    const relays = getCommunikeyRelays();

    for (const req of requests) {
      const formAddr = getFormRequestFormAddress(req);
      if (!formAddr || formTemplates.has(formAddr)) continue;

      const parts = formAddr.split(':');
      if (parts.length < 3) continue;
      const [, formPubkey, ...idParts] = parts;
      const identifier = idParts.join(':');

      subs.push(addressLoader({ kind: 30168, pubkey: formPubkey, identifier, relays }).subscribe());

      /** @type {import('rxjs').Subscription | undefined} */
      let modelSub;
      modelSub = eventStore.replaceable(30168, formPubkey, identifier).subscribe((event) => {
        if (event && !formTemplates.has(formAddr)) {
          formTemplates = new Map([...formTemplates, [formAddr, event]]);
        }
      });
      subs.push(modelSub);
    }

    return () => subs.forEach((s) => s.unsubscribe());
  });

  // Load user's form responses (kind 1069) to track status
  $effect(() => {
    if (!pubkey) return;

    const modelSub = eventStore
      .model(TimelineModel, { kinds: [1069], authors: [pubkey] })
      .subscribe((events) => {
        /** @type {Set<string>} */
        const responded = new SvelteSet();
        for (const e of events || []) {
          const aTag = e.tags.find((t) => t[0] === 'a')?.[1];
          if (aTag) responded.add(aTag);
        }
        respondedForms = responded;
      });

    return () => modelSub.unsubscribe();
  });

  // Profile loading for request senders
  const getProfiles = useProfileMap(() => requests.map((r) => r.pubkey));

  /**
   * Lazy decrypt a request's message
   * @param {import('nostr-tools').NostrEvent} request
   */
  async function decryptMessage(request) {
    if (decryptedMessages.has(request.id)) return;
    if (!manager.active || !request.content) return;

    try {
      const plaintext = await manager.active.signer.nip44Decrypt(request.pubkey, request.content);
      const msg = parseFormRequestMessage(plaintext);
      decryptedMessages = new Map([...decryptedMessages, [request.id, msg]]);
    } catch {
      decryptedMessages = new Map([...decryptedMessages, [request.id, '']]);
    }
  }

  /**
   * Navigate to form respond page
   * @param {string} formAddr
   */
  function navigateToForm(formAddr) {
    try {
      const naddr = formCoordinateToNaddr(formAddr, getCommunikeyRelays());
      goto(resolve(`/forms/${naddr}/respond`));
    } catch {
      // ignore
    }
  }
</script>

<section data-testid="dashboard-form-requests">
  <h2 class="mb-4 text-lg font-bold">{m.dashboard_requests_title()}</h2>

  {#if isLoading}
    <div class="flex justify-center py-8">
      <span class="loading loading-md loading-spinner text-primary"></span>
    </div>
  {:else if requests.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <ScrollTextIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.dashboard_requests_empty()}</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each requests as request (request.id)}
        {@const formAddr = getFormRequestFormAddress(request)}
        {@const formTemplate = formAddr ? formTemplates.get(formAddr) : null}
        {@const formName =
          formTemplate?.tags.find((t) => t[0] === 'name')?.[1] ||
          m.dashboard_requests_unknown_form()}
        {@const hasResponded = formAddr ? respondedForms.has(formAddr) : false}
        {@const profile = getProfiles()?.get(request.pubkey)}
        {@const msg = decryptedMessages.get(request.id)}

        {#if !decryptedMessages.has(request.id) && request.content}
          {@const _ = decryptMessage(request)}
        {/if}

        <button
          class="flex w-full items-start gap-3 rounded-lg border border-base-content/10 p-3 text-left transition-colors hover:bg-base-200/50"
          onclick={() => formAddr && navigateToForm(formAddr)}
        >
          <!-- Sender avatar -->
          <div class="placeholder avatar">
            <div class="w-10 rounded-full bg-neutral text-neutral-content">
              {#if profile && getProfilePicture(profile)}
                <img src={getProfilePicture(profile)} alt="" />
              {:else}
                <span class="text-xs">
                  {(profile ? getDisplayName(profile) : request.pubkey.slice(0, 2)).slice(0, 2)}
                </span>
              {/if}
            </div>
          </div>

          <!-- Content -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-semibold">
                {formName}
              </div>
              <div class="badge badge-sm {hasResponded ? 'badge-success' : 'badge-warning'}">
                {hasResponded ? m.dashboard_requests_responded() : m.dashboard_requests_pending()}
              </div>
            </div>
            <div class="text-xs text-base-content/50">
              {m.dashboard_requests_from()}
              {profile ? getDisplayName(profile) : request.pubkey.slice(0, 8) + '...'}
              &middot;
              {new Date(request.created_at * 1000).toLocaleDateString()}
            </div>
            {#if msg}
              <div class="mt-1 text-xs text-base-content/60 italic">"{msg}"</div>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</section>
