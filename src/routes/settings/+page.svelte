<script>
  import { SvelteMap } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import { manager } from '$lib/stores/accounts.svelte.js';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
  import {
    saveRelayList,
    validateRelayUrl,
    parseRelayListEvent
  } from '$lib/services/relay-settings-service.js';
  import { createRelayListLoader } from '$lib/loaders/relay-list-loader.js';
  import { createBlossomServerLoader } from '$lib/loaders/blossom-server-loader.js';
  import {
    saveBlossomServers,
    validateBlossomUrl,
    parseBlossomServerEvent,
    getDefaultBlossomServers
  } from '$lib/services/blossom-settings-service.js';
  import {
    CATEGORIES,
    getRelaySetDTag,
    getDefaultRelaysForCategory,
    parseRelaySetEvent,
    updateUserOverrideCache
  } from '$lib/services/app-relay-service.svelte.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
  import DmRelaySettings from '$lib/components/dm/DmRelaySettings.svelte';
  import LocalCachePanel from '$lib/components/settings/LocalCachePanel.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import MembershipCard from '$lib/components/membership/MembershipCard.svelte';
  import PomegranateExportCard from '$lib/components/settings/PomegranateExportCard.svelte';
  import * as m from '$lib/paraglide/messages';

  // Use $state + $effect for reactive RxJS subscription bridge (Svelte 5 pattern)
  let activeAccount = $state(/** @type {any} */ (null));

  $effect(() => {
    const subscription = manager.active$.subscribe((account) => {
      activeAccount = account;
    });
    return () => subscription.unsubscribe();
  });

  // State
  let loading = $state(true);
  let saving = $state(false);
  let _hasRelayList = $state(false);
  /** @type {Array<{url: string, read: boolean, write: boolean}>} */
  let relays = $state([]);
  let newRelayUrl = $state('');
  let newRelayRead = $state(true);
  let newRelayWrite = $state(true);
  /** @type {string|null} */
  let error = $state(null);
  /** @type {string|null} */
  let success = $state(null);
  /** @type {string|null} */
  let validationError = $state(null);
  let hasChanges = $state(false);

  // Blossom state
  let blossomLoading = $state(true);
  let blossomSaving = $state(false);
  let hasBlossomList = $state(false);
  /** @type {Array<{url: string}>} */
  let blossomServers = $state([]);
  let newBlossomUrl = $state('');
  /** @type {string|null} */
  let blossomError = $state(null);
  /** @type {string|null} */
  let blossomSuccess = $state(null);
  /** @type {string|null} */
  let blossomValidationError = $state(null);
  let hasBlossomChanges = $state(false);

  // App Relay state
  let appRelaysLoading = $state(true);
  let appRelaysSaving = $state(false);
  /** @type {SvelteMap<string, string[]>} */
  // eslint-disable-next-line svelte/no-unnecessary-state-wrap -- needed because variable is reassigned
  let appRelayOverrides = $state(new SvelteMap());
  /** @type {string|null} */
  let appRelaysError = $state(null);
  /** @type {string|null} */
  let appRelaysSuccess = $state(null);
  /** @type {string} */
  let newAppRelayUrl = $state('');
  /** @type {string|null} */
  let editingCategory = $state(null);
  /** @type {string|null} */
  let appRelayValidationError = $state(null);

  // Load relay list on mount
  $effect(() => {
    if (!activeAccount?.pubkey) {
      loading = false;
      return;
    }

    loading = true;
    error = null;

    const lookupRelays = getRelayListLookupRelays();

    // Create loader for kind 10002
    const loader = createRelayListLoader(pool, lookupRelays, eventStore, activeAccount.pubkey);
    const loaderSub = loader()().subscribe();

    // Subscribe to the relay list from EventStore
    const subscription = eventStore.replaceable(10002, activeAccount.pubkey).subscribe((event) => {
      loading = false;
      if (event) {
        _hasRelayList = true;
        relays = parseRelayListEvent(event);
      } else {
        _hasRelayList = false;
        relays = [];
      }
    });

    // Timeout after 5 seconds
    const timeout = setTimeout(() => {
      loading = false;
    }, 5000);

    return () => {
      loaderSub?.unsubscribe();
      subscription?.unsubscribe();
      clearTimeout(timeout);
    };
  });

  // Load Blossom server list on mount
  $effect(() => {
    if (!activeAccount?.pubkey) {
      blossomLoading = false;
      return;
    }

    blossomLoading = true;
    blossomError = null;

    const lookupRelays = getRelayListLookupRelays();

    // Create loader for kind 10063
    const loader = createBlossomServerLoader(pool, lookupRelays, eventStore, activeAccount.pubkey);
    const loaderSub = loader()().subscribe();

    // Subscribe to the Blossom server list from EventStore
    const subscription = eventStore.replaceable(10063, activeAccount.pubkey).subscribe((event) => {
      blossomLoading = false;
      if (event) {
        hasBlossomList = true;
        blossomServers = parseBlossomServerEvent(event);
      } else {
        hasBlossomList = false;
        blossomServers = [];
      }
    });

    // Timeout after 5 seconds
    const timeout = setTimeout(() => {
      blossomLoading = false;
    }, 5000);

    return () => {
      loaderSub?.unsubscribe();
      subscription?.unsubscribe();
      clearTimeout(timeout);
    };
  });

  // Load App Relay Sets on mount
  $effect(() => {
    if (!activeAccount?.pubkey) {
      appRelaysLoading = false;
      return;
    }

    appRelaysLoading = true;
    appRelaysError = null;

    const lookupRelays = getRelayListLookupRelays();

    // Load kind 30002 events via addressLoader (one per category)
    /** @type {import('rxjs').Subscription[]} */
    const loaderSubs = [];
    for (const category of Object.keys(CATEGORIES)) {
      const dTag = getRelaySetDTag(category);
      loaderSubs.push(
        addressLoader({
          kind: 30002,
          pubkey: activeAccount.pubkey,
          identifier: dTag,
          relays: lookupRelays
        }).subscribe()
      );
    }

    // Subscribe to each category's relay set
    /** @type {import('rxjs').Subscription[]} */
    const subscriptions = [];

    // Batch updates to avoid triggering multiple reactive cycles
    // eventStore.replaceable() uses ReplaySubject which immediately emits cached values
    /** @type {SvelteMap<string, string[]>} */
    const pendingUpdates = new SvelteMap();
    let updateScheduled = false;

    function scheduleUpdate() {
      if (updateScheduled) return;
      updateScheduled = true;
      queueMicrotask(() => {
        updateScheduled = false;
        // Apply all pending updates at once
        if (pendingUpdates.size > 0) {
          const newMap = new SvelteMap(appRelayOverrides);
          pendingUpdates.forEach((relays, category) => {
            newMap.set(category, relays);
            updateUserOverrideCache(category, relays);
          });
          pendingUpdates.clear();
          appRelayOverrides = newMap;
        }
      });
    }

    for (const category of Object.keys(CATEGORIES)) {
      const dTag = getRelaySetDTag(category);
      const sub = eventStore.replaceable(30002, activeAccount.pubkey, dTag).subscribe((event) => {
        const relays = parseRelaySetEvent(event);
        pendingUpdates.set(category, relays);
        scheduleUpdate();
      });
      subscriptions.push(sub);
    }

    // Mark loading complete after a short delay
    const timeout = setTimeout(() => {
      appRelaysLoading = false;
    }, 3000);

    return () => {
      loaderSubs.forEach((sub) => sub?.unsubscribe());
      subscriptions.forEach((sub) => sub?.unsubscribe());
      clearTimeout(timeout);
    };
  });

  // Create default relay list
  function createDefaultRelayList() {
    /** @type {string[]} */
    const fallbackRelays = runtimeConfig.fallbackRelays || [];
    if (fallbackRelays.length === 0) {
      error = 'No default relays configured. Please add relays manually.';
      return;
    }
    relays = fallbackRelays.slice(0, 4).map((/** @type {string} */ url) => ({
      url,
      read: true,
      write: true
    }));
    hasChanges = true;
  }

  // Add a new relay
  function addRelay() {
    const validation = validateRelayUrl(newRelayUrl);
    if (!validation.valid) {
      validationError = validation.error || null;
      return;
    }

    // Check for duplicates
    const normalizedUrl = newRelayUrl.trim().replace(/\/$/, '');
    if (relays.some((r) => r.url.replace(/\/$/, '') === normalizedUrl)) {
      validationError = m.settings_relay_duplicate();
      return;
    }

    relays = [
      ...relays,
      {
        url: normalizedUrl,
        read: newRelayRead,
        write: newRelayWrite
      }
    ];

    newRelayUrl = '';
    newRelayRead = true;
    newRelayWrite = true;
    validationError = null;
    hasChanges = true;
  }

  // Remove a relay
  function removeRelay(/** @type {number} */ index) {
    relays = relays.filter((_, i) => i !== index);
    hasChanges = true;
  }

  // Toggle read/write for a relay
  function toggleRead(/** @type {number} */ index) {
    relays[index].read = !relays[index].read;
    // Ensure at least one is selected
    if (!relays[index].read && !relays[index].write) {
      relays[index].write = true;
    }
    relays = [...relays]; // Trigger reactivity
    hasChanges = true;
  }

  function toggleWrite(/** @type {number} */ index) {
    relays[index].write = !relays[index].write;
    // Ensure at least one is selected
    if (!relays[index].read && !relays[index].write) {
      relays[index].read = true;
    }
    relays = [...relays]; // Trigger reactivity
    hasChanges = true;
  }

  // Save relay list
  async function handleSave() {
    if (relays.length === 0) {
      error = m.settings_relay_error_min();
      return;
    }

    saving = true;
    error = null;
    success = null;

    try {
      await saveRelayList(relays, activeAccount.pubkey);
      success = m.settings_relay_saved();
      hasChanges = false;
      _hasRelayList = true;
      setTimeout(() => (success = null), 3000);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      saving = false;
    }
  }

  // Handle Enter key in input
  function handleKeyDown(/** @type {KeyboardEvent} */ event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addRelay();
    }
  }

  // Create default Blossom server list
  function createDefaultBlossomList() {
    blossomServers = getDefaultBlossomServers().map((/** @type {string} */ url) => ({ url }));
    hasBlossomChanges = true;
  }

  // Add a new Blossom server
  function addBlossomServer() {
    const validation = validateBlossomUrl(newBlossomUrl);
    if (!validation.valid) {
      blossomValidationError = validation.error || null;
      return;
    }

    // Check for duplicates
    const normalizedUrl = newBlossomUrl.trim().replace(/\/$/, '');
    if (blossomServers.some((s) => s.url.replace(/\/$/, '') === normalizedUrl)) {
      blossomValidationError = m.settings_blossom_duplicate();
      return;
    }

    blossomServers = [...blossomServers, { url: normalizedUrl }];

    newBlossomUrl = '';
    blossomValidationError = null;
    hasBlossomChanges = true;
  }

  // Remove a Blossom server
  function removeBlossomServer(/** @type {number} */ index) {
    blossomServers = blossomServers.filter((_, i) => i !== index);
    hasBlossomChanges = true;
  }

  // Save Blossom server list
  async function handleBlossomSave() {
    if (blossomServers.length === 0) {
      blossomError = m.settings_blossom_error_min();
      return;
    }

    blossomSaving = true;
    blossomError = null;
    blossomSuccess = null;

    try {
      await saveBlossomServers(blossomServers, activeAccount.pubkey);
      blossomSuccess = m.settings_blossom_saved();
      hasBlossomChanges = false;
      hasBlossomList = true;
      setTimeout(() => (blossomSuccess = null), 3000);
    } catch (err) {
      blossomError = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      blossomSaving = false;
    }
  }

  // Handle Enter key in Blossom input
  function handleBlossomKeyDown(/** @type {KeyboardEvent} */ event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addBlossomServer();
    }
  }

  // App Relay functions

  /**
   * Get current relays for a category (override or server default)
   * @param {string} category
   * @returns {string[]}
   */
  function getRelaysForCategory(category) {
    const override = appRelayOverrides.get(category);
    if (override && override.length > 0) {
      return override;
    }
    return getDefaultRelaysForCategory(category);
  }

  /**
   * Check if category has user override
   * @param {string} category
   * @returns {boolean}
   */
  function hasOverride(category) {
    const override = appRelayOverrides.get(category);
    return (override && override.length > 0) ?? false;
  }

  /**
   * Save server defaults as user's relay set
   * @param {string} category
   */
  async function saveServerDefaultsAsMyRelays(category) {
    const serverDefaults = getDefaultRelaysForCategory(category);
    if (serverDefaults.length > 0) {
      await saveAppRelaySet(category, serverDefaults);
    }
  }

  /**
   * Save app relay set override
   * @param {string} category
   * @param {string[]} relays
   */
  async function saveAppRelaySet(category, relays) {
    if (!activeAccount?.signer) {
      appRelaysError = m.settings_no_signer();
      return;
    }

    appRelaysSaving = true;
    appRelaysError = null;

    try {
      const dTag = getRelaySetDTag(category);

      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dTag], ...relays.map((r) => ['relay', r])],
        content: ''
      };

      const signedEvent = await activeAccount.signer.signEvent(event);
      const lookupRelays = getRelayListLookupRelays();
      const result = await publishEvent(signedEvent, [], { additionalRelays: lookupRelays });
      if (!result.success) {
        appRelaysError = m.settings_app_relay_save_failed();
        return;
      }
      eventStore.add(signedEvent);

      // Update local state
      appRelayOverrides = new SvelteMap(appRelayOverrides.set(category, relays));
      updateUserOverrideCache(category, relays);

      appRelaysSuccess = m.settings_app_relay_saved({
        category: CATEGORIES[/** @type {keyof typeof CATEGORIES} */ (category)]?.label || category
      });
      setTimeout(() => (appRelaysSuccess = null), 3000);
    } catch (err) {
      appRelaysError = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      appRelaysSaving = false;
      editingCategory = null;
    }
  }

  /**
   * Reset category to use server defaults
   * @param {string} category
   */
  async function resetToDefault(category) {
    // Save empty relay set to clear override
    await saveAppRelaySet(category, []);
  }

  /**
   * Add a relay to a category
   * @param {string} category
   */
  async function addAppRelay(category) {
    if (!newAppRelayUrl.trim()) {
      appRelayValidationError = m.settings_app_relay_enter_url();
      return;
    }

    const validation = validateRelayUrl(newAppRelayUrl);
    if (!validation.valid) {
      appRelayValidationError = validation.error || null;
      return;
    }

    const normalizedUrl = newAppRelayUrl.trim().replace(/\/$/, '');
    const currentRelays = getRelaysForCategory(category);

    if (currentRelays.includes(normalizedUrl)) {
      appRelayValidationError = m.settings_app_relay_duplicate();
      return;
    }

    await saveAppRelaySet(category, [...currentRelays, normalizedUrl]);
    newAppRelayUrl = '';
    appRelayValidationError = null;
  }

  /**
   * Remove a relay from a category
   * @param {string} category
   * @param {string} relayUrl
   */
  async function removeAppRelay(category, relayUrl) {
    const currentRelays = getRelaysForCategory(category);
    const newRelays = currentRelays.filter((r) => r !== relayUrl);
    await saveAppRelaySet(category, newRelays);
  }

  /**
   * Handle Enter key in app relay input
   * @param {KeyboardEvent} event
   * @param {string} category
   */
  function handleAppRelayKeyDown(event, category) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addAppRelay(category);
    }
  }
</script>

<svelte:head>
  <title>{m.common_settings()} - {runtimeConfig.appName}</title>
</svelte:head>

<div class="px-4 py-8">
  <div class="mx-auto max-w-2xl">
    <!-- Header -->
    <div class="mb-8 text-center">
      <h1 class="mb-2 text-4xl font-bold">{m.common_settings()}</h1>
      <p class="text-base-content/70">{m.settings_subtitle()}</p>
    </div>

    <!-- Local Cache Panel (visible to all users) -->
    <div class="mb-6">
      <LocalCachePanel />
    </div>

    <!-- Membership Card (only when membership feature is enabled and user is logged in) -->
    {#if activeAccount}
      <div class="mb-6">
        <MembershipCard />
      </div>
    {/if}

    {#if !activeAccount}
      <div class="alert alert-warning shadow-lg">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span>{m.settings_login_required()}</span>
      </div>
    {:else if loading}
      <div class="flex justify-center py-12">
        <div class="text-center">
          <span class="loading loading-lg loading-spinner"></span>
          <p class="mt-4 text-base-content/70">{m.settings_relay_loading()}</p>
        </div>
      </div>
    {:else}
      <!-- Relay Preferences Card -->
      <div class="card bg-base-100 shadow-xl" transition:fade={{ duration: 200 }}>
        <div class="card-body">
          <h2 class="mb-2 card-title text-2xl">
            <span class="text-2xl">{m.settings_relay_title()}</span>
          </h2>
          <p class="mb-6 text-base-content/70">
            {m.settings_relay_description()}
            {m.settings_relay_description_detail({
              read: m.settings_relay_read_checkbox(),
              write: m.settings_relay_write_checkbox()
            })}
          </p>

          {#if relays.length === 0}
            <!-- No relay list state -->
            <div class="mb-6 alert alert-info">
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
                ></path>
              </svg>
              <div>
                <p class="font-semibold">{m.settings_relay_no_list()}</p>
                <p class="text-sm">
                  {m.settings_relay_no_list_description()}
                </p>
              </div>
            </div>
            <button class="btn btn-primary" onclick={createDefaultRelayList}>
              {m.settings_relay_create_defaults()}
            </button>
          {:else}
            <!-- Relay list -->
            <div class="mb-6 space-y-3">
              {#each relays as relay, index (relay.url)}
                <div
                  class="flex items-center gap-3 rounded-lg bg-base-100 p-3"
                  transition:fade={{ duration: 150 }}
                >
                  <div class="flex-1 truncate font-mono text-sm" title={relay.url}>
                    {relay.url}
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="label cursor-pointer gap-1">
                      <span class="label-text text-xs">{m.settings_relay_read_label()}</span>
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm checkbox-primary"
                        checked={relay.read}
                        onchange={() => toggleRead(index)}
                      />
                    </label>
                    <label class="label cursor-pointer gap-1">
                      <span class="label-text text-xs">{m.settings_relay_write_label()}</span>
                      <input
                        type="checkbox"
                        class="checkbox checkbox-sm checkbox-secondary"
                        checked={relay.write}
                        onchange={() => toggleWrite(index)}
                      />
                    </label>
                    <button
                      class="btn btn-square text-error btn-ghost btn-sm"
                      onclick={() => removeRelay(index)}
                      title={m.settings_relay_remove_aria()}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              {/each}
            </div>

            <!-- Add relay form -->
            <div class="divider">{m.settings_relay_add_divider()}</div>
            <div class="flex flex-col gap-3">
              <div class="join w-full">
                <input
                  type="text"
                  class="input-bordered input join-item flex-1"
                  placeholder="wss://relay.example.com"
                  bind:value={newRelayUrl}
                  onkeydown={handleKeyDown}
                />
                <button class="btn join-item btn-primary" onclick={addRelay}>
                  {m.settings_add_button()}
                </button>
              </div>
              <div class="flex items-center gap-4">
                <label class="label cursor-pointer gap-2">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm checkbox-primary"
                    bind:checked={newRelayRead}
                  />
                  <span class="label-text">{m.settings_relay_read_checkbox()}</span>
                </label>
                <label class="label cursor-pointer gap-2">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm checkbox-secondary"
                    bind:checked={newRelayWrite}
                  />
                  <span class="label-text">{m.settings_relay_write_checkbox()}</span>
                </label>
              </div>
              {#if validationError}
                <p class="text-sm text-error">{validationError}</p>
              {/if}
            </div>

            <!-- Legend -->
            <div class="mt-6 text-sm text-base-content/60">
              <span class="mr-2 badge badge-sm badge-primary">{m.settings_relay_read_label()}</span>
              {m.settings_relay_read_help()}
              <span class="mr-2 ml-4 badge badge-sm badge-secondary"
                >{m.settings_relay_write_label()}</span
              >
              {m.settings_relay_write_help()}
            </div>

            <!-- Save button -->
            <div class="mt-6 card-actions justify-end">
              <button
                class="btn gap-2 btn-lg btn-primary"
                onclick={handleSave}
                disabled={saving || !hasChanges}
              >
                {#if saving}
                  <span class="loading loading-sm loading-spinner"></span>
                  {m.settings_relay_saving()}
                {:else}
                  {m.settings_relay_save_changes()}
                {/if}
              </button>
            </div>
          {/if}
        </div>
      </div>

      <!-- Blossom Servers Card -->
      {#if blossomLoading}
        <div class="card mt-6 bg-base-100 shadow-xl">
          <div class="card-body">
            <div class="flex justify-center py-8">
              <div class="text-center">
                <span class="loading loading-md loading-spinner"></span>
                <p class="mt-2 text-sm text-base-content/70">{m.settings_blossom_loading()}</p>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="card mt-6 bg-base-100 shadow-xl" transition:fade={{ duration: 200 }}>
          <div class="card-body">
            <h2 class="mb-2 card-title text-2xl">
              <span class="text-2xl">{m.settings_blossom_title()}</span>
            </h2>
            <p class="mb-6 text-base-content/70">
              {m.settings_blossom_description()}
            </p>

            {#if !hasBlossomList && blossomServers.length === 0}
              <!-- No server list state -->
              <div class="mb-6 alert alert-info">
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
                  ></path>
                </svg>
                <div>
                  <p class="font-semibold">{m.settings_blossom_no_list()}</p>
                  <p class="text-sm">
                    {m.settings_blossom_no_list_description()}
                  </p>
                </div>
              </div>
              <button class="btn btn-primary" onclick={createDefaultBlossomList}>
                {m.settings_blossom_create_defaults()}
              </button>
            {:else}
              <!-- Server list -->
              <div class="mb-6 space-y-3">
                {#each blossomServers as server, index (server.url)}
                  <div
                    class="flex items-center gap-3 rounded-lg bg-base-100 p-3"
                    transition:fade={{ duration: 150 }}
                  >
                    <div class="flex-1 truncate font-mono text-sm" title={server.url}>
                      {server.url}
                    </div>
                    <button
                      class="btn btn-square text-error btn-ghost btn-sm"
                      onclick={() => removeBlossomServer(index)}
                      title={m.settings_blossom_remove_aria()}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                {/each}
              </div>

              <!-- Add server form -->
              <div class="divider">{m.settings_blossom_add_divider()}</div>
              <div class="flex flex-col gap-3">
                <div class="join w-full">
                  <input
                    type="text"
                    class="input-bordered input join-item flex-1"
                    placeholder="https://blossom.example.com"
                    bind:value={newBlossomUrl}
                    onkeydown={handleBlossomKeyDown}
                  />
                  <button class="btn join-item btn-primary" onclick={addBlossomServer}>
                    {m.settings_add_button()}
                  </button>
                </div>
                {#if blossomValidationError}
                  <p class="text-sm text-error">{blossomValidationError}</p>
                {/if}
              </div>

              <!-- Save button -->
              <div class="mt-6 card-actions justify-end">
                <button
                  class="btn gap-2 btn-lg btn-primary"
                  onclick={handleBlossomSave}
                  disabled={blossomSaving || !hasBlossomChanges}
                >
                  {#if blossomSaving}
                    <span class="loading loading-sm loading-spinner"></span>
                    {m.settings_relay_saving()}
                  {:else}
                    {m.settings_relay_save_changes()}
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- App-Specific Relays Card -->
      {#if appRelaysLoading}
        <div class="card mt-6 bg-base-100 shadow-xl">
          <div class="card-body">
            <div class="flex justify-center py-8">
              <div class="text-center">
                <span class="loading loading-md loading-spinner"></span>
                <p class="mt-2 text-sm text-base-content/70">{m.settings_app_relay_loading()}</p>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="card mt-6 bg-base-100 shadow-xl" transition:fade={{ duration: 200 }}>
          <div class="card-body">
            <h2 class="mb-2 card-title text-2xl">
              <span class="text-2xl">{m.settings_app_relay_title()}</span>
            </h2>
            <p class="mb-6 text-base-content/70">
              {m.settings_app_relay_description()}
            </p>

            {#each Object.entries(CATEGORIES) as [category, config] (category)}
              {@const override = appRelayOverrides.get(category) || []}
              {@const serverDefaults = getDefaultRelaysForCategory(category)}
              {@const effectiveRelays = override.length > 0 ? override : serverDefaults}
              {@const isEditing = editingCategory === category}

              <div class="mt-4 rounded-lg bg-base-100 p-4">
                <h3 class="mb-3 flex items-center gap-2 font-semibold">
                  {config.label}
                  {#if override.length > 0}
                    <span class="badge badge-sm badge-primary">{m.settings_app_relay_custom()}</span
                    >
                  {:else}
                    <span class="badge badge-ghost badge-sm"
                      >{m.settings_app_relay_server_default()}</span
                    >
                  {/if}
                </h3>

                <!-- Current relays -->
                <div class="space-y-2">
                  {#each effectiveRelays as relay (relay)}
                    <div class="flex items-center gap-2 rounded bg-base-200 p-2">
                      <span class="flex-1 truncate font-mono text-sm" title={relay}>{relay}</span>
                      {#if override.length > 0}
                        <button
                          class="btn btn-square text-error btn-ghost btn-xs"
                          onclick={() => removeAppRelay(category, relay)}
                          disabled={appRelaysSaving}
                          title={m.settings_relay_remove_aria()}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      {/if}
                    </div>
                  {/each}

                  {#if effectiveRelays.length === 0}
                    <p class="text-sm text-base-content/50 italic">
                      {m.settings_app_relay_no_relays()}
                    </p>
                  {/if}
                </div>

                <!-- Actions -->
                <div class="mt-3 flex flex-wrap gap-2">
                  {#if !hasOverride(category) && serverDefaults.length > 0}
                    <button
                      class="btn btn-xs btn-primary"
                      onclick={() => saveServerDefaultsAsMyRelays(category)}
                      disabled={appRelaysSaving}
                    >
                      {#if appRelaysSaving}
                        <span class="loading loading-xs loading-spinner"></span>
                      {/if}
                      {m.settings_app_relay_save_defaults()}
                    </button>
                  {/if}

                  {#if isEditing}
                    <!-- Add relay form -->
                    <div class="mt-2 w-full">
                      <div class="join w-full">
                        <input
                          type="text"
                          class="input-bordered input input-sm join-item flex-1"
                          placeholder="wss://relay.example.com"
                          bind:value={newAppRelayUrl}
                          onkeydown={(e) => handleAppRelayKeyDown(e, category)}
                        />
                        <button
                          class="btn join-item btn-sm btn-primary"
                          onclick={() => addAppRelay(category)}
                          disabled={appRelaysSaving}
                        >
                          {m.settings_add_button()}
                        </button>
                        <button
                          class="btn join-item btn-ghost btn-sm"
                          onclick={() => {
                            editingCategory = null;
                            newAppRelayUrl = '';
                            appRelayValidationError = null;
                          }}
                        >
                          {m.common_cancel()}
                        </button>
                      </div>
                      {#if appRelayValidationError}
                        <p class="mt-1 text-xs text-error">{appRelayValidationError}</p>
                      {/if}
                    </div>
                  {:else}
                    <button
                      class="btn btn-outline btn-xs"
                      onclick={() => {
                        editingCategory = category;
                        newAppRelayUrl = '';
                      }}
                      disabled={appRelaysSaving}
                    >
                      {m.settings_app_relay_add()}
                    </button>

                    {#if hasOverride(category)}
                      <button
                        class="btn btn-ghost btn-xs"
                        onclick={() => resetToDefault(category)}
                        disabled={appRelaysSaving}
                      >
                        {m.settings_app_relay_reset()}
                      </button>
                    {/if}
                  {/if}
                </div>

                <!-- Kind info -->
                <p class="mt-2 text-xs text-base-content/50">
                  Kinds: {config.kinds.join(', ')}
                </p>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Link Previews Card -->
      <div class="card mt-6 bg-base-100 shadow-xl" transition:fade={{ duration: 200 }}>
        <div class="card-body">
          <h2 class="mb-2 card-title text-2xl">
            <span class="text-2xl">{m.settings_link_previews_title()}</span>
          </h2>
          <p class="mb-6 text-base-content/70">
            {m.settings_link_previews_description()}
          </p>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={appSettings.linkPreviewsEnabled}
                onchange={(e) => {
                  appSettings.linkPreviewsEnabled = /** @type {HTMLInputElement} */ (
                    e.currentTarget
                  ).checked;
                }}
              />
              <span class="label-text font-medium">{m.settings_link_previews_label()}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Gated Mode Card -->
      <div class="card mt-6 bg-base-100 shadow-xl" transition:fade={{ duration: 200 }}>
        <div class="card-body">
          <h2 class="mb-2 card-title text-2xl">
            <span class="text-2xl">{m.settings_gated_mode_title()}</span>
          </h2>
          <p class="mb-6 text-base-content/70">
            {m.settings_gated_mode_description()}
          </p>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={appSettings.gatedMode}
                disabled={!appSettings.canToggleGatedMode}
                onchange={() => appSettings.toggleGatedMode()}
              />
              <div class="flex flex-col">
                <span class="label-text font-medium">
                  {m.settings_gated_mode_label()}
                </span>
                {#if !appSettings.canToggleGatedMode}
                  <span class="label-text-alt text-warning">
                    {m.settings_gated_mode_forced()}
                  </span>
                {/if}
              </div>
            </label>
          </div>

          <div class="mt-4 rounded-lg bg-base-100 p-4">
            <h3 class="mb-2 font-semibold">{m.settings_gated_mode_current_status()}</h3>
            {#if appSettings.gatedMode}
              <div class="flex items-center gap-2 text-success">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <span>{m.settings_gated_mode_enabled_status()}</span>
              </div>
              <p class="mt-2 text-sm text-base-content/60">
                {m.settings_gated_mode_enabled_description()}
              </p>
            {:else}
              <div class="flex items-center gap-2 text-base-content/70">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064"
                  />
                </svg>
                <span>{m.settings_gated_mode_disabled_status()}</span>
              </div>
              <p class="mt-2 text-sm text-base-content/60">
                {m.settings_gated_mode_disabled_description()}
              </p>
            {/if}
          </div>
        </div>
      </div>

      <!-- Client Tag Card -->
      <div class="card mt-6 bg-base-100 shadow-xl" transition:fade={{ duration: 200 }}>
        <div class="card-body">
          <h2 class="mb-2 card-title text-2xl">
            <span class="text-2xl">{m.settings_client_tag_title()}</span>
          </h2>
          <p class="mb-6 text-base-content/70">
            {m.settings_client_tag_description()}
          </p>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={appSettings.includeClientTag}
                onchange={() => (appSettings.includeClientTag = !appSettings.includeClientTag)}
              />
              <span class="label-text font-medium">
                {m.settings_client_tag_label({ clientName: runtimeConfig.clientName })}
              </span>
            </label>
          </div>
        </div>
      </div>

      <!-- DM Relay Settings Card -->
      <div
        id="dm-relay-settings"
        class="card mt-6 scroll-mt-20 bg-base-100 shadow-xl"
        transition:fade={{ duration: 200 }}
      >
        <div class="card-body">
          <DmRelaySettings />
        </div>
      </div>

      <!-- Recovery File Card (only for nsec accounts — extension/bunker
           accounts don't have a recoverable secret in this app) -->
      {#if activeAccount?.type === 'nsec'}
        <div
          class="card mt-6 bg-base-100 shadow-xl"
          data-testid="settings-recovery-card"
          transition:fade={{ duration: 200 }}
        >
          <div class="card-body">
            <h2 class="mb-2 card-title text-2xl">
              <span class="text-2xl">{m.settings_recovery_title()}</span>
            </h2>
            <p class="mb-6 text-base-content/70">{m.settings_recovery_description()}</p>
            <button
              class="btn btn-primary"
              data-testid="settings-recovery-download"
              onclick={() => modalStore.openModal('recovery-download')}
            >
              {m.settings_recovery_download_cta()}
            </button>
          </div>
        </div>
      {/if}

      <PomegranateExportCard />

      <!-- Developer Settings Card -->
      <div class="card mt-6 bg-base-100 shadow-xl" transition:fade={{ duration: 200 }}>
        <div class="card-body">
          <h2 class="mb-2 card-title text-2xl">
            <span class="text-2xl">{m.settings_developer_title()}</span>
          </h2>
          <p class="mb-6 text-base-content/70">
            {m.settings_debug_mode_description()}
          </p>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={appSettings.debugMode}
                onchange={(e) => (appSettings.debugMode = e.currentTarget.checked)}
              />
              <span class="label-text font-medium">
                {m.settings_debug_mode_label()}
              </span>
            </label>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<!-- Toast notifications - fixed at top-right -->
<div class="toast toast-end toast-top z-50">
  {#if success}
    <div class="alert alert-success shadow-lg" transition:fade={{ duration: 200 }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{success}</span>
    </div>
  {/if}
  {#if error}
    <div class="alert alert-error shadow-lg" transition:fade={{ duration: 200 }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{error}</span>
    </div>
  {/if}
  {#if blossomSuccess}
    <div class="alert alert-success shadow-lg" transition:fade={{ duration: 200 }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{blossomSuccess}</span>
    </div>
  {/if}
  {#if blossomError}
    <div class="alert alert-error shadow-lg" transition:fade={{ duration: 200 }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{blossomError}</span>
    </div>
  {/if}
  {#if appRelaysSuccess}
    <div class="alert alert-success shadow-lg" transition:fade={{ duration: 200 }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{appRelaysSuccess}</span>
    </div>
  {/if}
  {#if appRelaysError}
    <div class="alert alert-error shadow-lg" transition:fade={{ duration: 200 }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{appRelaysError}</span>
    </div>
  {/if}
</div>
