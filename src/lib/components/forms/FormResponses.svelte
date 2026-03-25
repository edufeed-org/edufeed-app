<script>
  import { TimelineModel } from 'applesauce-core/models';
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { parseResponseTags, parseFormTemplate } from '$lib/helpers/forms.js';
  import { formResponseLoader } from '$lib/loaders/community.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';

  /**
   * @type {{
   *   formEvent: import('nostr-tools').NostrEvent,
   *   formAddress: string
   * }}
   */
  let { formEvent, formAddress } = $props();

  const parsed = $derived(parseFormTemplate(formEvent));

  /** @type {import('nostr-tools').NostrEvent[]} */
  let responses = $state.raw([]);
  let isLoading = $state(true);

  /** @type {Map<string, Record<string, string>>} event id -> decrypted values */
  let decryptedMap = $state.raw(new Map());
  /** @type {Map<string, string>} event id -> error message */
  let decryptErrors = $state.raw(new Map());

  /** @type {Set<string>} expanded response IDs */
  let expanded = $state.raw(new Set());

  // Load responses
  $effect(() => {
    const loader = formResponseLoader(formAddress, formEvent.pubkey);
    const sub = loader().subscribe();

    const modelSub = eventStore.model(TimelineModel, { kinds: [1069] }).subscribe((events) => {
      const filtered = (events || []).filter((e) =>
        e.tags.some((t) => t[0] === 'a' && t[1] === formAddress)
      );
      responses = filtered;
      isLoading = false;
    });

    return () => {
      sub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // Profile loading for response authors
  const getProfiles = useProfileMap(() => responses.map((r) => r.pubkey));

  /**
   * Decrypt a response's content
   * @param {import('nostr-tools').NostrEvent} response
   */
  async function decryptResponse(response) {
    if (decryptedMap.has(response.id)) return;
    if (!manager.active) return;

    const isEncrypted = response.tags.some((t) => t[0] === 'encrypted');

    if (!isEncrypted) {
      const tags = response.tags.filter((t) => t[0] === 'response');
      const values = parseResponseTags(tags);
      decryptedMap = new Map([...decryptedMap, [response.id, values]]);
      return;
    }

    try {
      const plaintext = await manager.active.signer.nip44Decrypt(response.pubkey, response.content);
      const tags = JSON.parse(plaintext);
      const values = parseResponseTags(tags);
      decryptedMap = new Map([...decryptedMap, [response.id, values]]);
    } catch (_err) {
      decryptErrors = new Map([...decryptErrors, [response.id, 'Could not decrypt response']]);
    }
  }

  /**
   * Toggle expand and decrypt if needed
   * @param {import('nostr-tools').NostrEvent} response
   */
  function toggleExpand(response) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw() requires plain Set to avoid proxy issues with .has()
    const newExpanded = new Set(expanded);
    if (newExpanded.has(response.id)) {
      newExpanded.delete(response.id);
    } else {
      newExpanded.add(response.id);
      decryptResponse(response);
    }
    expanded = newExpanded;
  }
</script>

<div class="space-y-3">
  {#if isLoading}
    <div class="flex justify-center p-8">
      <span class="loading loading-md loading-spinner"></span>
    </div>
  {:else if responses.length === 0}
    <p class="py-8 text-center text-base-content/50">No responses yet.</p>
  {:else}
    {#each responses as response (response.id)}
      {@const profile = getProfiles()?.get(response.pubkey)}
      {@const isExpanded = expanded.has(response.id)}
      {@const values = decryptedMap.get(response.id)}
      {@const decryptError = decryptErrors.get(response.id)}

      <div class="overflow-hidden rounded-lg border border-base-content/15">
        <!-- Header -->
        <button
          class="flex w-full items-center justify-between bg-base-200/30 p-3 transition-colors hover:bg-base-200/50"
          onclick={() => toggleExpand(response)}
        >
          <div class="flex items-center gap-3">
            <div class="placeholder avatar">
              <div class="w-8 rounded-full bg-neutral text-neutral-content">
                {#if profile?.picture}
                  <img src={profile.picture} alt="" />
                {:else}
                  <span class="text-xs"
                    >{(profile?.name || response.pubkey.slice(0, 2)).slice(0, 2)}</span
                  >
                {/if}
              </div>
            </div>
            <div class="text-left">
              <div class="text-sm font-semibold">
                {profile?.name || response.pubkey.slice(0, 8) + '...'}
              </div>
              <div class="text-xs text-base-content/40">
                {new Date(response.created_at * 1000).toLocaleDateString()}
              </div>
            </div>
          </div>
        </button>

        <!-- Expanded content -->
        {#if isExpanded}
          <div class="space-y-2 p-3 text-sm">
            {#if decryptError}
              <div class="alert-sm alert alert-error">{decryptError}</div>
            {:else if values}
              {#each parsed.fields as field (field.id)}
                <div>
                  <div class="text-xs text-base-content/50">{field.label}</div>
                  <div>{values[field.id] || '\u2014'}</div>
                </div>
              {/each}
              <!-- Show unknown fields (from older form versions) -->
              {#each Object.entries(values).filter(([id]) => !parsed.fields.find((f) => f.id === id)) as [id, value] (id)}
                <div>
                  <div class="text-xs text-base-content/50">
                    {id} <span class="italic">(field removed)</span>
                  </div>
                  <div>{value}</div>
                </div>
              {/each}
            {:else}
              <div class="flex justify-center p-2">
                <span class="loading loading-sm loading-spinner"></span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
