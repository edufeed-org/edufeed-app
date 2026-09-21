<!--
  ContactSearchInput - Reusable contact search input with dropdown.
  Searches user's followed contacts (kind 3) and displays matching profiles.
  Optional opt-in flags add combobox behaviours used by AddProfileRow:
  - showExcluded: render excluded contacts disabled with a badge
  - acceptPubkeyInput: append a synthetic "add this pubkey" row when the
    input parses as a valid npub/hex and has no existing contact match
  - inlineList: render the suggestion list in normal flow instead of as an
    absolute overlay. Inside a DaisyUI modal-box the overlay form is clipped
    by the box's overflow-y:auto (the box does not grow for absolute
    children), so suggestions end up half-hidden behind a scrollbar
  - acceptNameInput: append a synthetic "add as name" row for any plain-text
    term (>= 2 chars, not a pubkey) so a participant without an npub can be
    entered verbatim — fires onrawname with the trimmed term
  - searchProfiles: also suggest people OUTSIDE the follow list — profiles
    already in the EventStore (community members, chat authors, …) plus a
    debounced NIP-50 search on the configured search relays. Follows always
    come first; every pubkey appears once. Issue f2763558: a tester with one
    follow typed a name on the community wizard's people step and got
    nothing at all ("und hier hätte ich jetzt erwartet, dass ich Vorschläge
    bekomme"). Non-follow rows are ordered by NIP-85 trust rank (kind 30382
    from the configured providers, see loaders/trust-assertions.js) and
    scored rows carry a small "in web of trust" badge — so of two profiles
    named alike, the one the network vouches for sits on top. Unscored
    rows are never hidden: a teacher new to Nostr has no score anywhere.
-->

<script>
  import { untrack } from 'svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useTrustScores } from '$lib/stores/trust-scores.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from './ProfileAvatar.svelte';
  import { nip19 } from 'nostr-tools';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { normalizePubkey } from '$lib/helpers/pubkey.js';
  import {
    searchKnownProfiles,
    profileNameSearchLoader,
    profileToContact,
    profileMatches
  } from '$lib/loaders/profile-search.js';
  import * as m from '$lib/paraglide/messages';
  import ImageWithFallback from './ImageWithFallback.svelte';

  const MAX_ITEMS = 10;
  // Keystroke → relay request debounce. Local legs (follows, known
  // profiles) stay synchronous; only the network leg waits.
  const REMOTE_DEBOUNCE_MS = 300;

  /**
   * @type {{
   *   value?: string,
   *   placeholder?: string,
   *   disabled?: boolean,
   *   onselect?: (contact: import('$lib/stores/contacts.svelte.js').EnrichedContact) => void,
   *   onrawpubkey?: (hex: string) => void,
   *   onrawname?: (name: string) => void,
   *   onblur?: () => void,
   *   inputClass?: string,
   *   id?: string,
   *   testid?: string,
   *   exclude?: string[],
   *   showExcluded?: boolean,
   *   acceptPubkeyInput?: boolean,
   *   acceptNameInput?: boolean,
   *   inlineList?: boolean,
   *   searchProfiles?: boolean,
   *   excludedLabel?: string,
   *   addPubkeyLabel?: string
   * }}
   */
  let {
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    onselect,
    onrawpubkey,
    onrawname,
    onblur,
    inputClass = '',
    id = undefined,
    testid = undefined,
    exclude = [],
    showExcluded = false,
    acceptPubkeyInput = false,
    acceptNameInput = false,
    inlineList = false,
    searchProfiles = false,
    excludedLabel = '',
    addPubkeyLabel = ''
  } = $props();

  /**
   * @typedef {{ kind: 'contact', contact: import('$lib/stores/contacts.svelte.js').EnrichedContact, pubkey: string, excluded: boolean }} ContactNavItem
   * @typedef {{ kind: 'pubkey', pubkey: string, npub: string, excluded: boolean }} PubkeyNavItem
   * @typedef {{ kind: 'name', name: string, pubkey: string, excluded: false }} NameNavItem
   * @typedef {ContactNavItem | PubkeyNavItem | NameNavItem} NavItem
   */

  // Resolve the profile for a pasted npub/hex so the synthetic row shows the
  // real avatar + name instead of a generic person glyph (journey-test
  // 2026-08-17: the invite-by-npub flow never rendered who was being added).
  const getPubkeyProfiles = useProfileMap(() =>
    navItems.filter((item) => item.kind === 'pubkey').map((item) => item.pubkey)
  );

  let showDropdown = $state(false);
  let selectedDropdownIndex = $state(-1);
  /** @type {NavItem[]} */
  let navItems = $state([]);
  // True while a NIP-50 request is in flight (spinner in the hint line).
  let remoteBusy = $state(false);
  /** The term navItems were built for — plain let, re-read by the re-sort effect. */
  let currentTerm = '';

  // Trust scores for the contact rows on screen (searchProfiles only).
  const getTrustScores = useTrustScores(() =>
    searchProfiles
      ? navItems.filter((item) => item.kind === 'contact').map((item) => item.pubkey)
      : []
  );

  // A score that lands after the rows did re-sorts the OPEN list in place.
  // Only the scores are tracked: navItems/showDropdown are read untracked so
  // the rebuild's own writes cannot re-trigger this effect, and a closed
  // list (row picked, field left) is never re-opened by a late score.
  $effect(() => {
    getTrustScores();
    untrack(() => {
      if (searchProfiles && showDropdown) rebuildItems(currentTerm);
    });
  });

  /**
   * Rank for ordering: unscored = -1 so it sorts after any scored row.
   * @param {string} pubkey
   */
  function rankOf(pubkey) {
    return getTrustScores().get(pubkey)?.rank ?? -1;
  }

  // Remote-leg bookkeeping — plain lets, never $state (internal refs).
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let remoteTimer;
  /** @type {import('rxjs').Subscription | undefined} */
  let remoteSub;
  /** The term the current remoteMatches belong to. */
  let remoteTerm = '';
  /** @type {import('$lib/stores/contacts.svelte.js').EnrichedContact[]} */
  let remoteMatches = [];

  function cancelRemoteSearch() {
    clearTimeout(remoteTimer);
    remoteTimer = undefined;
    remoteSub?.unsubscribe();
    remoteSub = undefined;
    remoteBusy = false;
  }

  $effect(() => cancelRemoteSearch);

  /**
   * Debounced NIP-50 leg. Results are merged into the list as they arrive;
   * a newer term cancels the pending timer and any in-flight request.
   * @param {string} term
   */
  function scheduleRemoteSearch(term) {
    cancelRemoteSearch();
    remoteMatches = [];
    remoteTerm = term;
    // A pasted key is resolved by the synthetic pubkey row, not by name search.
    if (term.length < 2 || normalizePubkey(term)) return;
    remoteTimer = setTimeout(() => {
      remoteBusy = true;
      remoteSub = profileNameSearchLoader(term, MAX_ITEMS).subscribe({
        next: (event) => {
          const contact = profileToContact(event);
          if (!profileMatches(contact, term)) return;
          if (remoteMatches.some((c) => c.pubkey === event.pubkey)) return;
          remoteMatches = [...remoteMatches, /** @type {any} */ (contact)];
          rebuildItems(term);
        },
        error: () => {
          remoteBusy = false;
        },
        complete: () => {
          remoteBusy = false;
        }
      });
    }, REMOTE_DEBOUNCE_MS);
  }

  /**
   * Recompute dropdown items for a given search term from every enabled
   * source: follows → known profiles → remote results, each pubkey once,
   * capped at MAX_ITEMS, plus the synthetic pubkey row.
   * @param {string} term already trimmed
   */
  function rebuildItems(term) {
    currentTerm = term;
    const follows = term.length >= 2 ? contactsStore.searchContacts(term, MAX_ITEMS) : [];
    /** @type {import('$lib/stores/contacts.svelte.js').EnrichedContact[]} */
    const merged = [...follows];
    if (searchProfiles && term.length >= 2) {
      // Local dedupe scratch inside one synchronous pass — nothing renders
      // from it, so a reactive SvelteSet would only add proxy overhead.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const seen = new Set(merged.map((c) => c.pubkey));
      const known = searchKnownProfiles(term, MAX_ITEMS, { exclude: [...seen] });
      const extras = remoteTerm === term ? [...known, ...remoteMatches] : known;
      /** @type {import('$lib/stores/contacts.svelte.js').EnrichedContact[]} */
      const others = [];
      for (const c of extras) {
        if (seen.has(c.pubkey)) continue;
        seen.add(c.pubkey);
        others.push(c);
      }
      // Stable sort: ties (and the unscored tail) keep source order —
      // known profiles before relay hits, relay hits in relay order.
      merged.push(...others.toSorted((a, b) => rankOf(b.pubkey) - rankOf(a.pubkey)));
    }
    const matches = merged.slice(0, MAX_ITEMS);

    /** @type {ContactNavItem[]} */
    const contactItems = (
      showExcluded ? matches : matches.filter((c) => !exclude.includes(c.pubkey))
    ).map((c) => ({
      kind: /** @type {'contact'} */ ('contact'),
      contact: c,
      pubkey: c.pubkey,
      excluded: exclude.includes(c.pubkey)
    }));

    /** @type {PubkeyNavItem | null} */
    let pubkeyItem = null;
    if (acceptPubkeyInput) {
      const hex = normalizePubkey(term);
      if (hex && !matches.some((c) => c.pubkey === hex)) {
        pubkeyItem = {
          kind: 'pubkey',
          pubkey: hex,
          npub: nip19.npubEncode(hex),
          excluded: exclude.includes(hex)
        };
      }
    }

    /** @type {NameNavItem | null} */
    let nameItem = null;
    if (acceptNameInput && term.length >= 2 && !pubkeyItem && !normalizePubkey(term)) {
      // `pubkey` doubles as the {#each} key; the prefix keeps it disjoint
      // from real hex keys.
      nameItem = { kind: 'name', name: term, pubkey: `name:${term}`, excluded: false };
    }

    navItems = [
      ...contactItems,
      ...(pubkeyItem ? [pubkeyItem] : []),
      ...(nameItem ? [nameItem] : [])
    ];
    showDropdown = navItems.length > 0;
  }

  /**
   * Input handler: recompute synchronously, then kick off the remote leg.
   * @param {string} searchTerm
   */
  function searchContacts(searchTerm) {
    selectedDropdownIndex = -1;
    const term = (searchTerm || '').trim();
    if (searchProfiles) scheduleRemoteSearch(term);
    rebuildItems(term);
  }

  /**
   * Handle keyboard navigation in dropdown.
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    if (showDropdown && navItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedDropdownIndex = Math.min(selectedDropdownIndex + 1, navItems.length - 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedDropdownIndex = Math.max(selectedDropdownIndex - 1, -1);
      } else if (event.key === 'Enter' && selectedDropdownIndex >= 0) {
        event.preventDefault();
        selectItem(navItems[selectedDropdownIndex]);
      } else if (event.key === 'Escape') {
        // Escape means "close the list", not "cancel the dialog": inside a
        // <dialog> the un-prevented keydown would also fire the dialog's
        // cancel and throw away every wizard field the user has filled in.
        event.preventDefault();
        event.stopPropagation();
        showDropdown = false;
        selectedDropdownIndex = -1;
      }
    }
  }

  /**
   * Select an item from the dropdown. No-op for excluded rows.
   * @param {NavItem} item
   */
  function selectItem(item) {
    if (item.excluded) return;
    showDropdown = false;
    navItems = [];
    selectedDropdownIndex = -1;
    if (item.kind === 'contact') {
      onselect?.(item.contact);
    } else if (item.kind === 'name') {
      onrawname?.(item.name);
    } else {
      onrawpubkey?.(item.pubkey);
    }
  }

  function handleBlur() {
    // Late relay results must not pop the list open under a field the user
    // has already left.
    cancelRemoteSearch();
    setTimeout(() => {
      showDropdown = false;
    }, 200);
    onblur?.();
  }

  /**
   * Short, human-friendly preview of an npub for the synthetic row.
   * @param {string} npub
   */
  function shortNpub(npub) {
    return npub.length > 16 ? `${npub.slice(0, 12)}…${npub.slice(-4)}` : npub;
  }
</script>

<div class="relative">
  <input
    {id}
    data-testid={testid}
    type="text"
    class="input-bordered input w-full {inputClass}"
    {placeholder}
    bind:value
    oninput={(e) => searchContacts(e.currentTarget.value)}
    onkeydown={handleKeydown}
    onblur={handleBlur}
    {disabled}
  />

  {#if showDropdown && navItems.length > 0}
    <div
      data-testid="contact-search-list"
      class="mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 {inlineList
        ? ''
        : 'absolute z-50 shadow-lg'}"
      style={inlineList ? undefined : 'top: 100%;'}
    >
      {#each navItems as item, index (item.kind + ':' + item.pubkey)}
        {#if item.kind === 'contact'}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200"
            class:bg-base-200={index === selectedDropdownIndex}
            class:opacity-60={item.excluded}
            disabled={item.excluded}
            aria-disabled={item.excluded ? 'true' : undefined}
            onclick={() => selectItem(item)}
          >
            <ImageWithFallback
              src={item.contact.picture}
              alt=""
              size="avatar_sm"
              class="h-8 w-8 rounded-full object-cover"
              fallbackType="avatar"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">
                {item.contact.display_name || item.contact.name || 'Anonymous'}
              </div>
              {#if item.contact.nip05}
                <div class="truncate text-xs text-base-content/60">{item.contact.nip05}</div>
              {/if}
            </div>
            {#if item.excluded && excludedLabel}
              <span class="badge badge-sm">{excludedLabel}</span>
            {:else if searchProfiles && getTrustScores().get(item.pubkey)}
              {@const score = getTrustScores().get(item.pubkey)}
              <span
                data-testid="contact-search-wot-badge"
                class="badge shrink-0 badge-ghost badge-sm"
                title={m.contact_search_wot_title({
                  hops: score?.hops ?? '–',
                  followers: score?.followers ?? '–'
                })}
              >
                {m.contact_search_wot_known()}
              </span>
            {/if}
          </button>
        {:else if item.kind === 'name'}
          <button
            type="button"
            data-testid="contact-search-add-name"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200"
            class:bg-base-200={index === selectedDropdownIndex}
            onclick={() => selectItem(item)}
          >
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-sm font-medium text-base-content/70"
              aria-hidden="true"
            >
              {item.name.charAt(0).toUpperCase()}
            </div>
            <div class="min-w-0 flex-1 truncate text-sm">
              {m.contact_search_add_name({ name: item.name })}
            </div>
          </button>
        {:else}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200"
            class:bg-base-200={index === selectedDropdownIndex}
            class:opacity-60={item.excluded}
            disabled={item.excluded}
            aria-disabled={item.excluded ? 'true' : undefined}
            onclick={() => selectItem(item)}
          >
            {#if getPubkeyProfiles().get(item.pubkey)}
              <ProfileAvatar
                pubkey={item.pubkey}
                profile={getPubkeyProfiles().get(item.pubkey)}
                size="sm"
              />
            {:else}
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-base-content/60"
                aria-hidden="true"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  stroke="currentColor"
                  class="h-5 w-5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0v.75h-15v-.75Z"
                  />
                </svg>
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">
                {getDisplayName(getPubkeyProfiles().get(item.pubkey)) || addPubkeyLabel}
              </div>
              <div class="truncate font-mono text-xs text-base-content/60">
                {shortNpub(item.npub)}
              </div>
            </div>
            {#if item.excluded && excludedLabel}
              <span class="badge badge-sm">{excludedLabel}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  {#if searchProfiles}
    <div class="label py-0">
      <span class="label-text-alt flex items-center gap-1 text-xs text-base-content/60">
        {#if remoteBusy}
          <span class="loading loading-xs loading-spinner"></span>
          {m.contact_search_profiles_searching()}
        {:else}
          {m.contact_search_profiles_hint()}
        {/if}
      </span>
    </div>
  {:else if contactsStore.isLoaded && contactsStore.contacts.length > 0}
    <div class="label py-0">
      <span class="label-text-alt text-xs text-base-content/60">
        {m.contact_search_hint({ count: contactsStore.contacts.length })}
      </span>
    </div>
  {:else if contactsStore.isLoading}
    <div class="label py-0">
      <span class="label-text-alt flex items-center gap-1 text-xs text-base-content/60">
        <span class="loading loading-xs loading-spinner"></span>
        {m.contact_search_loading()}
      </span>
    </div>
  {:else}
    <div class="label py-0">
      <span class="label-text-alt text-xs text-base-content/60">
        {m.contact_search_enter_npub()}
      </span>
    </div>
  {/if}
</div>
