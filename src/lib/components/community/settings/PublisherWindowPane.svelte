<!--
  PublisherWindowPane — the Schaufenster manager for concord communities
  (spec: docs/nips/communikey-groups.md "Publisher window"). Owner-only
  (mounted by SettingsView behind isOwner + concord pointer). Two-step by
  design: offering the Publisher role NEVER lists anyone — only a member's
  own kind-3320 acceptance plus the owner's sync writes the public 30000.

  Concord submodules imported DIRECTLY (never the barrel) — the convention
  every Concord component follows (see CLAUDE.md's Concord section).
-->
<script>
  import {
    usePublisherWindow,
    offerPublisherRole,
    revokePublisherRole,
    syncPublishersList,
    saveWindowSections
  } from '$lib/concord/publisher-window.svelte.js';
  import {
    WINDOW_CONTENT_TYPES,
    windowSectionKeys,
    hasUngatedPublicSections
  } from '$lib/concord/publisher-window.js';
  import { useConcordCommunity } from '$lib/concord/community.svelte.js';
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import { getCommunitySigner } from '$lib/helpers/community-signer.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent } = $props();

  const getWindow = usePublisherWindow(() => communikeyEvent);
  const getConcord = useConcordCommunity(() => communikeyEvent);
  const getAreaMembers = useObservable(
    () => getConcord().community?.members$,
    /** @type {Set<string>} */ (new Set())
  );

  const communitySigner = $derived.by(() => getCommunitySigner(communikeyEvent?.pubkey));
  const rows = $derived.by(() => {
    const me = communikeyEvent?.pubkey;
    return [...getAreaMembers()].filter((pubkey) => pubkey !== me);
  });
  const getProfiles = useProfileMap(() => rows);

  let busyPubkey = $state(/** @type {string | null} */ (null));
  let syncing = $state(false);

  // ── Window section picker (Privat mit Schaufenster) ──
  // Only for communities whose ONLY public surface is the window: an open
  // community's ungated sections are managed in Inhalte & Rechte, and mixing
  // the two pickers would let this one silently drop those sections.
  const windowPickerAvailable = $derived(
    !hasUngatedPublicSections(communikeyEvent?.tags ?? [], communikeyEvent?.pubkey ?? '')
  );
  const savedWindowKeys = $derived(
    windowSectionKeys(communikeyEvent?.tags ?? [], communikeyEvent?.pubkey ?? '')
  );
  // Owner's in-progress choice; null = untouched, mirror the saved state.
  let draftWindowKeys = $state(/** @type {string[] | null} */ (null));
  const windowKeys = $derived(draftWindowKeys ?? savedWindowKeys);
  const windowDirty = $derived(
    windowKeys.length !== savedWindowKeys.length ||
      windowKeys.some((key) => !savedWindowKeys.includes(key))
  );
  let savingWindow = $state(false);

  /** @param {string} key */
  function toggleWindowKey(key) {
    const current = windowKeys;
    draftWindowKeys = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
  }

  async function saveWindow() {
    if (savingWindow || !communitySigner) return;
    savingWindow = true;
    try {
      await saveWindowSections({ communikeyEvent, communitySigner, selectedKeys: windowKeys });
      draftWindowKeys = null;
      showToast(m.publisher_window_saved(), 'success');
    } catch (error) {
      console.error('publisher: window save failed', error);
      showToast(m.publisher_action_failed(), 'error');
    } finally {
      savingWindow = false;
    }
  }

  /** @param {string} key */
  function windowTypeLabel(key) {
    const labels = /** @type {Record<string, () => string>} */ ({
      learning: m.publisher_window_type_learning,
      articles: m.publisher_window_type_articles,
      calendar: m.publisher_window_type_calendar,
      posts: m.publisher_window_type_posts,
      wikis: m.publisher_window_type_wikis,
      polls: m.publisher_window_type_polls,
      bookmarks: m.publisher_window_type_bookmarks
    });
    return labels[key]?.() ?? key;
  }

  /** @param {string} pubkey @returns {'listed'|'accepted'|'declined'|'offered'|'none'} */
  function stateOf(pubkey) {
    const window = getWindow();
    if (window.currentList.includes(pubkey)) return 'listed';
    if (!window.granted.has(pubkey)) return 'none';
    const consent = window.consents.get(pubkey);
    if (consent === 'accepted') return 'accepted';
    if (consent === 'revoked') return 'declined';
    return 'offered';
  }

  /** @param {string} pubkey */
  async function offer(pubkey) {
    const window = getWindow();
    if (!window.community || busyPubkey) return;
    busyPubkey = pubkey;
    try {
      await offerPublisherRole(
        window.community,
        getRolesForActions(),
        getGrantsForActions(),
        pubkey
      );
      showToast(m.publisher_offer_sent(), 'success');
    } catch (error) {
      console.error('publisher: offer failed', error);
      showToast(m.publisher_action_failed(), 'error');
    } finally {
      busyPubkey = null;
    }
  }

  /** @param {string} pubkey */
  async function revoke(pubkey) {
    const window = getWindow();
    if (!window.community || busyPubkey) return;
    busyPubkey = pubkey;
    try {
      await revokePublisherRole(
        window.community,
        getRolesForActions(),
        getGrantsForActions(),
        pubkey
      );
      showToast(m.publisher_revoked(), 'success');
    } catch (error) {
      console.error('publisher: revoke failed', error);
      showToast(m.publisher_action_failed(), 'error');
    } finally {
      busyPubkey = null;
    }
  }

  // The action helpers need the raw roles/grants the hook folded from —
  // read them from the engine's state$ BehaviorSubject (synchronous value).
  function getRolesForActions() {
    return getWindow().community?.state$?.value?.roles ?? [];
  }
  function getGrantsForActions() {
    return getWindow().community?.state$?.value?.grants ?? new Map();
  }

  async function sync() {
    const window = getWindow();
    if (syncing || !communitySigner) return;
    syncing = true;
    try {
      await syncPublishersList({
        communikeyEvent,
        communitySigner,
        shouldList: window.shouldList,
        listEvent: window.listEvent
      });
      showToast(m.publisher_sync_done(), 'success');
    } catch (error) {
      console.error('publisher: list sync failed', error);
      showToast(m.publisher_action_failed(), 'error');
    } finally {
      syncing = false;
    }
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="publisher-window-pane">
  <div class="card-body">
    <h2 class="card-title">🪟 {m.publisher_pane_title()}</h2>
    <p class="text-sm text-base-content/70">{m.publisher_pane_lead()}</p>

    {#if rows.length === 0}
      <p class="text-sm text-base-content/50">{m.publisher_pane_empty()}</p>
    {:else}
      <div class="mt-2 flex flex-col gap-2">
        {#each rows as pubkey (pubkey)}
          {@const state = stateOf(pubkey)}
          <div class="flex items-center gap-2" data-testid="publisher-row" data-pubkey={pubkey}>
            <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
            <span class="min-w-0 flex-1 truncate text-sm"
              >{getDisplayName(getProfiles().get(pubkey)) || pubkey.slice(0, 12)}</span
            >
            {#if state === 'listed'}
              <span class="badge badge-sm badge-primary">{m.publisher_state_listed()}</span>
            {:else if state === 'accepted'}
              <span class="badge badge-sm badge-success">{m.publisher_state_accepted()}</span>
            {:else if state === 'offered'}
              <span class="badge badge-ghost badge-sm">{m.publisher_state_offered()}</span>
            {:else if state === 'declined'}
              <span class="badge badge-ghost badge-sm">{m.publisher_state_declined()}</span>
            {/if}
            {#if state === 'none' || state === 'declined'}
              <button
                class="btn btn-outline btn-xs"
                disabled={busyPubkey !== null}
                onclick={() => offer(pubkey)}
              >
                {m.publisher_offer()}
              </button>
            {:else}
              <button
                class="btn btn-ghost btn-xs"
                disabled={busyPubkey !== null}
                onclick={() => revoke(pubkey)}
              >
                {m.publisher_revoke()}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if getWindow().dirty}
      <div class="mt-3">
        <button
          class="btn btn-sm btn-neutral"
          data-testid="publisher-sync"
          disabled={syncing || !communitySigner}
          onclick={sync}
        >
          {#if syncing}<span class="loading loading-xs loading-spinner"></span>{/if}
          {m.publisher_sync()}
        </button>
        <p class="mt-1 text-xs text-base-content/60">{m.publisher_sync_hint()}</p>
      </div>
    {/if}

    {#if windowPickerAvailable}
      <div class="mt-4 border-t border-base-300 pt-4" data-testid="publisher-window-picker">
        <h3 class="text-sm font-bold">{m.publisher_window_sections_title()}</h3>
        <p class="mt-1 text-xs text-base-content/60">{m.publisher_window_sections_lead()}</p>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {#each WINDOW_CONTENT_TYPES as type (type.key)}
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                data-testid="publisher-window-type"
                data-key={type.key}
                checked={windowKeys.includes(type.key)}
                onchange={() => toggleWindowKey(type.key)}
              />
              {windowTypeLabel(type.key)}
            </label>
          {/each}
        </div>
        {#if windowDirty}
          <button
            class="btn mt-3 btn-sm btn-neutral"
            data-testid="publisher-window-save"
            disabled={savingWindow || !communitySigner}
            onclick={saveWindow}
          >
            {#if savingWindow}<span class="loading loading-xs loading-spinner"></span>{/if}
            {m.publisher_window_save()}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
