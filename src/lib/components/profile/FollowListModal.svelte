<!--
  FollowListModal — the people behind "N Follower" / "M Gefolgt" on a
  profile (issue 891be310): profile cards sorted by name, a search box,
  a phone-contacts style A-Z index rail, an "only people I follow" filter
  and follow / unfollow per row. Profiles load in one batch (useProfileMap)
  so the list can be sorted and searched; rows render PAGE at a time.
-->
<script>
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import { SearchIcon } from '$lib/components/icons';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { toggleFollow } from '$lib/helpers/follow.js';
  import { hexToNpub } from '$lib/helpers/pubkey.js';
  import {
    RAIL_LETTERS,
    buildFollowListEntries,
    letterIndex,
    matchesQuery,
    queryWords
  } from '$lib/helpers/follow-list.js';
  import * as m from '$lib/paraglide/messages';

  const PAGE = 50;
  /** The A-Z rail appears from this many (filtered) people on. */
  const RAIL_MIN = 20;

  /** @type {{ title: string, pubkeys: string[], viewerFollows: string[], onclose: () => void }} */
  let { title, pubkeys, viewerFollows, onclose } = $props();

  let shownCount = $state(PAGE);
  let query = $state('');
  let onlyFollowed = $state(false);

  const getProfiles = useProfileMap(() => pubkeys);
  const profiles = $derived(getProfiles());

  // npub encoding is the costly part of an entry and never changes per pubkey.
  /** @type {Map<string, string>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- memo cache, not state
  const npubCache = new Map();
  /** @param {string} hex */
  function npubOf(hex) {
    let npub = npubCache.get(hex);
    if (npub === undefined) {
      npub = hexToNpub(hex) || hex;
      npubCache.set(hex, npub);
    }
    return npub;
  }

  const entries = $derived(buildFollowListEntries(pubkeys, profiles, npubOf));
  const followed = $derived(new Set(viewerFollows));
  const followedHere = $derived(entries.filter((e) => followed.has(e.pubkey)).length);

  const getActiveUser = useActiveUser();
  const me = $derived(getActiveUser()?.pubkey);
  const showFollowedFilter = $derived(!!me && followedHere > 0);

  const filtered = $derived.by(() => {
    const words = queryWords(query);
    const mineOnly = onlyFollowed && showFollowedFilter;
    return entries.filter((e) => (!mineOnly || followed.has(e.pubkey)) && matchesQuery(e, words));
  });
  const shown = $derived(filtered.slice(0, shownCount));
  const index = $derived(letterIndex(filtered));
  const showRail = $derived(filtered.length >= RAIL_MIN);

  // Follow buttons only once the viewer's own kind 3 is in the store:
  // FollowUser starts a fresh contact list when none is loaded, and this
  // list must never risk wiping one that just hasn't arrived yet (same rule
  // as the profile hover card).
  let contactListLoaded = $state(false);
  $effect(() => {
    const viewer = me;
    if (!viewer) {
      contactListLoaded = false;
      return;
    }
    const sub = eventStore.replaceable(3, viewer).subscribe((event) => {
      contactListLoaded = !!event;
    });
    return () => sub.unsubscribe();
  });
  const canFollow = $derived(!!me && contactsStore.isLoaded && contactListLoaded);
  const pending = new SvelteSet();

  /** @param {string} pubkey */
  async function handleFollow(pubkey) {
    if (pending.has(pubkey)) return;
    pending.add(pubkey);
    try {
      await toggleFollow(pubkey, followed.has(pubkey));
    } finally {
      pending.delete(pubkey);
    }
  }

  /** @type {HTMLElement | undefined} */
  let listEl;

  function restart() {
    shownCount = PAGE;
    if (listEl) listEl.scrollTop = 0;
  }

  /**
   * Scroll so the first person under `letter` is the top row, rendering
   * further pages first when they lie beyond the shown ones. Scrolls the
   * list itself (not scrollIntoView, which would also move the modal box
   * and the page behind it).
   * @param {string} letter
   */
  async function jumpTo(letter) {
    const i = index.get(letter);
    if (i === undefined) return;
    if (i >= shownCount) shownCount = Math.ceil((i + 1) / PAGE) * PAGE;
    await tick();
    const pubkey = filtered[i]?.pubkey;
    const row = /** @type {HTMLElement | null | undefined} */ (
      listEl?.querySelector(`[data-pubkey="${pubkey}"]`)
    );
    if (row && listEl) listEl.scrollTo({ top: row.offsetTop });
  }

  // Press + drag along the rail: the letter under the pointer, by position
  // (every letter gets an equal slice of the rail's height).
  let dragging = false;
  let lastLetter = '';

  /** @param {PointerEvent} e */
  function letterAt(e) {
    const rail = /** @type {HTMLElement} */ (e.currentTarget);
    const rect = rail.getBoundingClientRect();
    if (!rect.height) return null;
    const slot = Math.floor(((e.clientY - rect.top) / rect.height) * RAIL_LETTERS.length);
    return RAIL_LETTERS[Math.max(0, Math.min(RAIL_LETTERS.length - 1, slot))];
  }

  /** @param {PointerEvent} e */
  function railJump(e) {
    const letter = letterAt(e);
    if (!letter || letter === lastLetter || !index.has(letter)) return;
    lastLetter = letter;
    jumpTo(letter);
  }

  /** @param {PointerEvent} e */
  function onRailDown(e) {
    dragging = true;
    lastLetter = '';
    /** @type {HTMLElement} */ (e.currentTarget).setPointerCapture?.(e.pointerId);
    railJump(e);
  }

  /** @param {PointerEvent} e */
  function onRailMove(e) {
    if (dragging) railJump(e);
  }

  function onRailUp() {
    dragging = false;
  }
</script>

<div class="modal-open modal" role="dialog" aria-label={title}>
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-extrabold">{title}</h3>

    <label class="input input-sm mt-3 w-full">
      <SearchIcon class_="h-4 w-4 opacity-60" />
      <input
        type="search"
        class="grow"
        bind:value={query}
        oninput={restart}
        placeholder={m.profile_follow_list_search_placeholder()}
        aria-label={m.profile_follow_list_search_label()}
      />
    </label>

    {#if showFollowedFilter}
      <label class="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="toggle toggle-primary toggle-sm"
          bind:checked={onlyFollowed}
          onchange={restart}
        />
        <span>{m.profile_follow_list_only_followed()} ({followedHere})</span>
      </label>
    {/if}

    <div class="relative my-3">
      <ul
        bind:this={listEl}
        class="relative max-h-[60vh] space-y-2 overflow-y-auto {showRail ? 'pr-7' : ''}"
        data-testid="follow-list"
      >
        {#each shown as entry (entry.pubkey)}
          {@const isFollowed = followed.has(entry.pubkey)}
          <li
            class="flex items-center gap-2"
            data-testid="follow-list-row"
            data-pubkey={entry.pubkey}
          >
            <div class="min-w-0 flex-1">
              <ProfileCard
                pubkey={entry.pubkey}
                profile={profiles.get(entry.pubkey)}
                size="sm"
                showIcon={false}
                showNip05
              />
            </div>
            {#if canFollow && entry.pubkey !== me}
              <button
                type="button"
                class="btn shrink-0 btn-sm {isFollowed ? 'btn-ghost' : 'btn-outline btn-primary'}"
                data-testid="follow-list-follow"
                disabled={pending.has(entry.pubkey)}
                onclick={() => handleFollow(entry.pubkey)}
              >
                {#if pending.has(entry.pubkey)}
                  <span class="loading loading-xs loading-spinner"></span>
                {:else if isFollowed}
                  {m.profile_unfollow_button()}
                {:else}
                  {m.profile_follow_button()}
                {/if}
              </button>
            {/if}
          </li>
        {/each}
      </ul>

      {#if showRail}
        <!-- Index letters, not text actions: a dense column of tiny targets
             (a btn's min-height would not fit 27 of them), styled by tokens. -->
        <nav
          class="absolute inset-y-0 right-0 flex w-6 touch-none flex-col select-none"
          aria-label={m.profile_follow_list_index_label()}
          data-testid="follow-list-rail"
          onpointerdown={onRailDown}
          onpointermove={onRailMove}
          onpointerup={onRailUp}
          onpointercancel={onRailUp}
        >
          {#each RAIL_LETTERS as letter (letter)}
            <button
              type="button"
              class="flex min-h-0 flex-1 items-center justify-center rounded-sm text-[0.625rem] leading-none font-bold text-primary hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:text-base-content/25 disabled:hover:bg-transparent"
              disabled={!index.has(letter)}
              aria-label={letter === '#'
                ? m.profile_follow_list_jump_to_other()
                : m.profile_follow_list_jump_to({ letter })}
              onclick={() => jumpTo(letter)}
            >
              {letter}
            </button>
          {/each}
        </nav>
      {/if}
    </div>

    {#if filtered.length === 0 && entries.length > 0}
      <p class="py-6 text-center text-sm text-base-content/60" data-testid="follow-list-no-match">
        {m.profile_follow_list_no_match()}
      </p>
    {/if}

    {#if filtered.length > shownCount}
      <button
        type="button"
        class="btn w-full btn-ghost btn-sm"
        onclick={() => (shownCount += PAGE)}
      >
        {m.common_show_more()}
      </button>
    {/if}
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={onclose}>{m.common_close()}</button>
    </div>
  </div>
  <button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={onclose}
  ></button>
</div>
