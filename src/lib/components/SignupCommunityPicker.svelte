<script>
  import { nip19 } from 'nostr-tools';
  import { SvelteSet } from 'svelte/reactivity';
  import { TimelineModel } from 'applesauce-core/models';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';

  let { selected = $bindable(new SvelteSet()) } = $props();

  /** @type {import('rxjs').Subscription | undefined} */
  let storeSub;
  let communities = $state.raw(/** @type {any[]} */ ([]));
  let searchQuery = $state('');

  /** @param {string} id */
  function normalizeToHex(id) {
    if (!id || typeof id !== 'string') return null;
    if (/^[0-9a-f]{64}$/i.test(id)) return id.toLowerCase();
    if (!id.startsWith('npub1')) return null;
    try {
      const decoded = nip19.decode(id);
      return decoded.type === 'npub' ? /** @type {string} */ (decoded.data) : null;
    } catch {
      return null;
    }
  }

  const suggestedPubkeys = $derived.by(() => {
    const ids = runtimeConfig.signup?.suggestedCommunities || [];
    return new Set(/** @type {string[]} */ (ids.map(normalizeToHex).filter(Boolean)));
  });

  $effect(() => {
    storeSub = eventStore.model(TimelineModel, { kinds: [10222] }).subscribe((events) => {
      communities = events;
    });
    return () => storeSub?.unsubscribe();
  });

  const getProfiles = useProfileMap(() => communities.map((c) => c.pubkey));

  const suggestedCommunities = $derived(communities.filter((c) => suggestedPubkeys.has(c.pubkey)));
  const otherCommunities = $derived(communities.filter((c) => !suggestedPubkeys.has(c.pubkey)));

  // Browse list: shown when search is empty so users without a known community
  // name still have something to discover. Newest first, capped at 12.
  const browseOthers = $derived(
    otherCommunities.toSorted((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 12)
  );

  /**
   * Normalize text for fuzzy substring search: lowercase + strip everything
   * that is not a letter or digit (handles hyphens, dots, spaces, etc.) so
   * e.g. "e-teaching" matches the query "etea".
   * @param {string} s
   */
  function normalizeForSearch(s) {
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  const filteredOthers = $derived.by(() => {
    const q = normalizeForSearch(searchQuery.trim());
    if (!q) return [];
    const profiles = getProfiles();
    return otherCommunities
      .filter((c) => {
        const p = profiles.get(c.pubkey);
        const name = normalizeForSearch(p?.display_name || p?.name || '');
        const about = normalizeForSearch(p?.about || '');
        return name.includes(q) || about.includes(q);
      })
      .slice(0, 20);
  });

  /** @param {string} pubkey */
  function toggle(pubkey) {
    if (selected.has(pubkey)) selected.delete(pubkey);
    else selected.add(pubkey);
  }
</script>

<div class="space-y-4">
  <p class="text-base opacity-80">{m.auth_signup_modal_step3_subtitle()}</p>

  {#if suggestedCommunities.length > 0}
    <div>
      <h3 class="mb-2 text-sm font-semibold opacity-80">
        {m.auth_signup_modal_step3_suggested_heading()}
      </h3>
      <ul class="space-y-2">
        {#each suggestedCommunities as c (c.pubkey)}
          {@const profile = getProfiles().get(c.pubkey)}
          {@const name = profile?.display_name || profile?.name}
          <li data-testid="signup-community-row">
            <label class="flex cursor-pointer items-center gap-3">
              <input
                data-testid="signup-community-checkbox"
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={selected.has(c.pubkey)}
                onchange={() => toggle(c.pubkey)}
              />
              <div class="avatar">
                <div class="h-8 w-8 rounded-full bg-base-300">
                  {#if profile?.picture}
                    <img src={profile.picture} alt="" loading="lazy" />
                  {/if}
                </div>
              </div>
              <div class="min-w-0 flex-1">
                {#if name}
                  <div class="truncate text-sm font-medium">{name}</div>
                  {#if profile?.about}
                    <div class="truncate text-xs opacity-70">{profile.about}</div>
                  {/if}
                {:else}
                  <code class="text-xs opacity-70">{c.pubkey.slice(0, 16)}…</code>
                {/if}
              </div>
            </label>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div>
    <input
      data-testid="signup-community-search"
      type="search"
      bind:value={searchQuery}
      placeholder={m.auth_signup_modal_step3_search_placeholder()}
      class="input-bordered input input-sm w-full"
    />

    {#if searchQuery.trim().length === 0 && browseOthers.length > 0}
      <h3 class="mt-4 mb-2 text-sm font-semibold opacity-80">
        {m.auth_signup_modal_step3_browse_heading()}
      </h3>
      <ul class="space-y-2">
        {#each browseOthers as c (c.pubkey)}
          {@const profile = getProfiles().get(c.pubkey)}
          {@const name = profile?.display_name || profile?.name}
          <li data-testid="signup-community-row">
            <label class="flex cursor-pointer items-center gap-3">
              <input
                data-testid="signup-community-checkbox"
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={selected.has(c.pubkey)}
                onchange={() => toggle(c.pubkey)}
              />
              <div class="avatar">
                <div class="h-8 w-8 rounded-full bg-base-300">
                  {#if profile?.picture}
                    <img src={profile.picture} alt="" loading="lazy" />
                  {/if}
                </div>
              </div>
              <div class="min-w-0 flex-1">
                {#if name}
                  <div class="truncate text-sm font-medium">{name}</div>
                  {#if profile?.about}
                    <div class="truncate text-xs opacity-70">{profile.about}</div>
                  {/if}
                {:else}
                  <code class="text-xs opacity-70">{c.pubkey.slice(0, 16)}…</code>
                {/if}
              </div>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    {#if searchQuery.trim().length > 0}
      {#if filteredOthers.length === 0}
        <p class="mt-2 text-sm opacity-70">{m.auth_signup_modal_step3_no_matches()}</p>
      {:else}
        <ul class="mt-2 space-y-2">
          {#each filteredOthers as c (c.pubkey)}
            {@const profile = getProfiles().get(c.pubkey)}
            {@const name = profile?.display_name || profile?.name}
            <li data-testid="signup-community-row">
              <label class="flex cursor-pointer items-center gap-3">
                <input
                  data-testid="signup-community-checkbox"
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked={selected.has(c.pubkey)}
                  onchange={() => toggle(c.pubkey)}
                />
                <div class="avatar">
                  <div class="h-8 w-8 rounded-full bg-base-300">
                    {#if profile?.picture}
                      <img src={profile.picture} alt="" loading="lazy" />
                    {/if}
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  {#if name}
                    <div class="truncate text-sm font-medium">{name}</div>
                    {#if profile?.about}
                      <div class="truncate text-xs opacity-70">{profile.about}</div>
                    {/if}
                  {:else}
                    <code class="text-xs opacity-70">{c.pubkey.slice(0, 16)}…</code>
                  {/if}
                </div>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>
