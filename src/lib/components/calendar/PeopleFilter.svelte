<!--
  PeopleFilter Component
  Replaces the prior "Follow-Listen" + "Autoren" dropdowns with a single
  "People" filter that exposes:
    1. a quick toggle at the top:
       - logged in   → "Only people I follow"  (pool: user's NIP-02 follows)
       - logged out  → "Featured educators"    (pool: configured featured authors)
    2. individual people (avatar + name) drawn from the active pool, with
       multi-select; toggling routes into selectedFeaturedAuthors so the
       rest of the store stays compatible.
    3. named NIP-51 follow sets for logged-in users (re-uses existing
       followLists loaded by followListLoader).
  All changes auto-apply; there is no internal "Apply" button.
-->

<script>
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { loadFollowList, loadFollowSets } from '$lib/helpers/followListLoader.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { normalizePubkey } from '$lib/helpers/pubkey.js';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { UserIcon } from '../icons';
  import SearchInput from './SearchInput.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {Object} Props
   *  @property {string[]} [featuredAuthors]  Configured featured author pubkeys (hex)
   *  @property {() => void} [onChange]       Fires whenever a people-related selection changes
   */

  /** @type {Props} */
  let { featuredAuthors = [], onChange = () => {} } = $props();

  let activeUser = $state(manager.active);
  /** @type {import('rxjs').Subscription | undefined} */
  let userSubscription;

  let isLoadingLists = $state(false);
  let loadError = $state(/** @type {string | null} */ (null));

  let isLoggedIn = $derived(!!activeUser);

  // The pool of individual people to show as avatars. Logged-in users see
  // their own follows; logged-out users see the deployment's featured list.
  let peoplePool = $derived(isLoggedIn ? calendarFilters.userFollowPubkeys : featuredAuthors);

  // Sync the featured pool into the store so getEffectiveAuthorPubkeys()
  // can resolve mode === 'featured' without needing the prop directly.
  $effect(() => {
    calendarFilters.setFeaturedAuthorPubkeys(featuredAuthors);
  });

  // Keep the quick-toggle semantics sensible when login state changes: a
  // "follows" mode is meaningless once logged out.
  $effect(() => {
    if (!isLoggedIn && calendarFilters.onlyFollowsMode === 'follows') {
      calendarFilters.setOnlyFollowsMode('off');
    }
  });

  const getProfiles = useProfileMap(() => peoplePool);

  function displayName(/** @type {string} */ pubkey) {
    const p = getProfiles().get(pubkey);
    return p?.name || p?.display_name || pubkey.slice(0, 8);
  }

  // Local search state for the people-filter dropdown. Empty string means
  // "no filter" — the avatar grid renders the full peoplePool.
  let peopleSearchQuery = $state('');

  let filteredPeoplePool = $derived.by(() => {
    const q = peopleSearchQuery.trim().toLowerCase();
    if (!q) return peoplePool;
    return peoplePool.filter((pubkey) => displayName(pubkey).toLowerCase().includes(q));
  });

  /**
   * Submit handler for the search input. If the query parses as an npub or
   * 64-char hex pubkey, add it as a featured-author filter. Otherwise no-op
   * (typing a partial name is for filtering only).
   * @param {string} value
   */
  function tryAddByPubkey(value) {
    const hex = normalizePubkey(value);
    if (!hex) return;
    if (calendarFilters.selectedFeaturedAuthors.includes(hex)) {
      peopleSearchQuery = '';
      return;
    }
    calendarFilters.addFeaturedAuthor(hex);
    peopleSearchQuery = '';
    onChange();
  }

  function avatarUrl(/** @type {string} */ pubkey) {
    const p = getProfiles().get(pubkey);
    try {
      return p ? getProfilePicture(p, undefined) : undefined;
    } catch {
      return undefined;
    }
  }

  async function loadLists() {
    if (!manager.active) return;
    const userPubkey = manager.active.pubkey;
    isLoadingLists = true;
    loadError = null;
    try {
      const [nip02, nip51] = await Promise.all([
        loadFollowList(userPubkey).catch(() => null),
        loadFollowSets(userPubkey).catch(() => [])
      ]);
      const lists = [...(nip02 ? [nip02] : []), ...nip51];
      calendarFilters.setFollowLists(lists);
      if (nip02) {
        calendarFilters.setUserFollowPubkeys(nip02.pubkeys);
      } else {
        calendarFilters.setUserFollowPubkeys([]);
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load follow lists';
    } finally {
      isLoadingLists = false;
    }
  }

  onMount(() => {
    userSubscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    if (manager.active) loadLists();
    return () => userSubscription?.unsubscribe();
  });

  $effect(() => {
    if (activeUser) {
      loadLists();
    } else {
      calendarFilters.clearFollowLists();
      calendarFilters.setUserFollowPubkeys([]);
      calendarFilters.setSelectedFollowListIds([]);
    }
  });

  function toggleMode(/** @type {'follows' | 'featured'} */ target) {
    const next = calendarFilters.onlyFollowsMode === target ? 'off' : target;
    calendarFilters.setOnlyFollowsMode(next);
    onChange();
  }

  function togglePerson(/** @type {string} */ pubkey) {
    if (calendarFilters.selectedFeaturedAuthors.includes(pubkey)) {
      calendarFilters.removeFeaturedAuthor(pubkey);
    } else {
      calendarFilters.addFeaturedAuthor(pubkey);
    }
    onChange();
  }

  function toggleList(/** @type {string} */ listId) {
    const next = calendarFilters.selectedFollowListIds.includes(listId)
      ? calendarFilters.selectedFollowListIds.filter((id) => id !== listId)
      : [...calendarFilters.selectedFollowListIds, listId];
    calendarFilters.setSelectedFollowListIds(next);
    onChange();
  }

  function clearAllPeople() {
    calendarFilters.setOnlyFollowsMode('off');
    calendarFilters.clearSelectedFeaturedAuthors();
    calendarFilters.clearSelectedFollowListIds();
    onChange();
  }

  // NIP-51 named sets only (NIP-02 is exposed via the quick toggle).
  // Dedupe by id so concurrent list loads (onMount + activeUser effect)
  // cannot produce duplicate keys in the each block below.
  let namedSets = $derived.by(() => {
    const seen = new SvelteSet();
    const out = [];
    for (const l of calendarFilters.followLists) {
      if (l.type !== 'nip51') continue;
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l);
    }
    return out;
  });

  let hasAnyPeopleFilter = $derived(
    calendarFilters.onlyFollowsMode !== 'off' ||
      calendarFilters.selectedFeaturedAuthors.length > 0 ||
      calendarFilters.selectedFollowListIds.length > 0
  );

  let activeCount = $derived(
    (calendarFilters.onlyFollowsMode !== 'off' ? 1 : 0) +
      calendarFilters.selectedFeaturedAuthors.length +
      calendarFilters.selectedFollowListIds.length
  );
</script>

<div class="dropdown">
  <button
    type="button"
    tabindex="0"
    class="btn gap-1 btn-outline btn-sm"
    data-filter-trigger
    data-testid="people-filter-trigger"
  >
    <UserIcon class_="h-4 w-4" />
    <span>{m.people_filter_title()}</span>
    {#if activeCount > 0}
      <span class="badge badge-sm badge-primary" data-filter-count>{activeCount}</span>
    {/if}
    <span aria-hidden="true">▾</span>
  </button>

  <div
    tabindex="-1"
    class="dropdown-content z-30 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
    data-testid="people-filter-panel"
  >
    <!-- Quick toggle row -->
    {#if isLoggedIn}
      <label
        class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 p-3 hover:bg-base-200"
      >
        <span class="text-sm font-medium">{m.people_filter_only_follows()}</span>
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          checked={calendarFilters.onlyFollowsMode === 'follows'}
          onchange={() => toggleMode('follows')}
          data-testid="people-filter-only-follows"
        />
      </label>
    {:else if featuredAuthors.length > 0}
      <label
        class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 p-3 hover:bg-base-200"
      >
        <span class="text-sm font-medium">{m.people_filter_featured_educators()}</span>
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          checked={calendarFilters.onlyFollowsMode === 'featured'}
          onchange={() => toggleMode('featured')}
          data-testid="people-filter-featured-toggle"
        />
      </label>
    {:else}
      <p class="rounded-lg bg-base-200 p-3 text-sm text-base-content/70">
        {m.people_filter_login_hint()}
      </p>
    {/if}

    <!-- Search bar: filters the avatar grid by display name; on Enter,
         a parsed npub/hex is added as a featured-author filter. -->
    <div class="mt-3" data-testid="people-filter-search">
      <SearchInput
        value={peopleSearchQuery}
        debounceMs={0}
        placeholder={m.people_filter_search_placeholder()}
        ariaLabel={m.people_filter_search_aria()}
        clearAriaLabel={m.people_filter_search_clear_aria()}
        onChange={(/** @type {string} */ v) => (peopleSearchQuery = v)}
        onSubmit={tryAddByPubkey}
      />
    </div>

    <!-- Individual people -->
    {#if peoplePool.length > 0}
      <details
        class="mt-3 rounded-lg border border-base-300"
        open={activeCount > 0 || peopleSearchQuery.trim().length > 0}
      >
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium select-none">
          {m.people_filter_individual_people()} ({filteredPeoplePool.length}{peopleSearchQuery.trim()
            .length > 0
            ? `/${peoplePool.length}`
            : ''})
        </summary>
        {#if filteredPeoplePool.length === 0}
          <p class="px-3 pb-3 text-xs text-base-content/60" data-testid="people-filter-no-matches">
            {m.people_filter_no_matches()}
          </p>
        {:else}
          <div
            class="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto px-3 pb-3"
            data-testid="people-filter-individual-grid"
          >
            {#each filteredPeoplePool as pubkey (pubkey)}
              {@const isSelected = calendarFilters.selectedFeaturedAuthors.includes(pubkey)}
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={displayName(pubkey)}
                onclick={() => togglePerson(pubkey)}
                class="flex flex-col items-center gap-1 rounded-lg p-2 transition {isSelected
                  ? 'bg-primary/10 ring-2 ring-primary'
                  : 'hover:bg-base-200'}"
              >
                <div class="avatar">
                  <div class="w-10 rounded-full bg-base-300">
                    {#if avatarUrl(pubkey)}
                      <img src={avatarUrl(pubkey)} alt="" />
                    {/if}
                  </div>
                </div>
                <span class="max-w-[5rem] truncate text-xs">{displayName(pubkey)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </details>
    {/if}

    <!-- Named NIP-51 sets -->
    {#if isLoggedIn}
      {#if isLoadingLists}
        <div class="mt-3 flex items-center gap-2 text-sm text-base-content/60">
          <div class="loading loading-sm loading-spinner"></div>
          <span>{m.people_filter_loading_lists()}</span>
        </div>
      {:else if loadError}
        <div class="mt-3 text-sm text-warning">{loadError}</div>
      {:else if namedSets.length > 0}
        <details class="mt-3 rounded-lg border border-base-300">
          <summary class="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            {m.people_filter_named_lists()} ({namedSets.length})
          </summary>
          <div class="space-y-1 px-3 pb-3">
            {#each namedSets as list (list.id)}
              <label class="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-base-200">
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs checkbox-primary"
                  checked={calendarFilters.selectedFollowListIds.includes(list.id)}
                  onchange={() => toggleList(list.id)}
                />
                <span class="flex-1 text-sm">{list.name}</span>
                <span class="text-xs text-base-content/50">{list.count}</span>
              </label>
            {/each}
          </div>
        </details>
      {/if}
    {/if}

    {#if hasAnyPeopleFilter}
      <button
        type="button"
        class="btn mt-3 w-full btn-ghost btn-xs"
        onclick={clearAllPeople}
        data-testid="people-filter-clear"
      >
        {m.people_filter_clear()}
      </button>
    {/if}
  </div>
</div>
