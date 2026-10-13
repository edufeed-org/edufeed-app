<!--
  RemovedContentPane — "Entfernte Inhalte" in community settings.

  Lists the removal labels (kind 1985, src/lib/groups/content-removal.js) that
  currently count for this community, newest first, and lets whoever signed a
  removal undo it. Undo is a NIP-09 deletion of the label, so it needs the
  label author's key: a moderator restores their own removals, the community
  key holder restores the community-signed ones. Other entries are listed
  read-only with a hint, never hidden — a moderator should see what their
  colleagues removed.

  Rendered by SettingsView only when the viewer can moderate (layout's
  `communityModeration` context); this component does not re-check that.
-->
<script>
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { fetchEventsByIds } from '$lib/helpers/repost-resolution.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';
  import { parseContentRemoval } from '$lib/groups/content-removal.js';
  import { canRestoreRemoval } from '$lib/helpers/publishContentRemoval.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { formatTimestamp } from '$lib/helpers/dates.js';
  import { showToast } from '$lib/helpers/toast';
  import { unique } from '$lib/helpers/unique.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   removals: any[],
   *   communikeyEvent: any,
   *   onRestore: (label: any) => Promise<void>
   * }}
   */
  let { removals = [], communikeyEvent, onRestore } = $props();

  const getProfiles = useProfileMap(() => removals.map((label) => label.pubkey));

  // Resolved target events keyed by label id. $state.raw: Nostr events carry
  // Symbol-based relay provenance, and the Map is always replaced wholesale.
  let resolved = $state.raw(/** @type {Map<string, any>} */ (new Map()));
  let busyId = $state(/** @type {string | null} */ (null));

  /**
   * The one target a label names (the app writes one label per item; a
   * foreign multi-target label shows its first target).
   * @param {any} label
   * @returns {{address?: {kind: number, pubkey: string, identifier: string}, id?: string, kind: number | null} | null}
   */
  function targetOf(label) {
    const parsed = parseContentRemoval(label);
    if (!parsed) return null;
    const address = parsed.addresses[0];
    if (address) {
      const i = address.indexOf(':');
      const j = address.indexOf(':', i + 1);
      return {
        kind: Number(address.slice(0, i)),
        address: {
          kind: Number(address.slice(0, i)),
          pubkey: address.slice(i + 1, j),
          identifier: address.slice(j + 1)
        }
      };
    }
    return { kind: parsed.kind, id: parsed.ids[0] };
  }

  /** @param {ReturnType<typeof targetOf>} target */
  function lookup(target) {
    if (!target) return undefined;
    if (target.address) {
      const { kind, pubkey, identifier } = target.address;
      return eventStore.getReplaceable(kind, pubkey, identifier);
    }
    return target.id ? eventStore.getEvent(target.id) : undefined;
  }

  // Resolve what each label points at: synchronously from the store when
  // possible, otherwise load it and wait for the store to emit it. Keyed by
  // label id so a re-render never re-requests (plain Set: internal ref).
  /** @type {Set<string>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, not reactive state
  const requested = new Set();
  $effect(() => {
    const labels = removals;
    const relays = unique([...getCommunityGlobalRelays(communikeyEvent), ...getAllLookupRelays()]);
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    /** @type {string[]} */
    const missingIds = [];
    for (const label of labels) {
      if (requested.has(label.id)) continue;
      requested.add(label.id);
      const target = targetOf(label);
      const found = lookup(target);
      if (found) {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- new snapshot of a $state.raw Map
        resolved = new Map(resolved).set(label.id, found);
        continue;
      }
      if (!target) continue;
      /** @type {import('rxjs').Observable<any> | undefined} */
      let source;
      if (target.address) {
        const { kind, pubkey, identifier } = target.address;
        subs.push(addressLoader({ kind, pubkey, identifier, relays }).subscribe());
        source = eventStore.replaceable(kind, pubkey, identifier);
      } else if (target.id) {
        missingIds.push(target.id);
        source = eventStore.event(target.id);
      }
      if (source) {
        subs.push(
          source.subscribe((event) => {
            // eslint-disable-next-line svelte/prefer-svelte-reactivity -- new snapshot of a $state.raw Map
            if (event) resolved = new Map(resolved).set(label.id, event);
          })
        );
      }
    }
    const byId = fetchEventsByIds(missingIds, relays, { pool, eventStore });
    if (byId) subs.push(byId);
    return () => {
      for (const sub of subs) sub.unsubscribe();
    };
  });

  const rows = $derived(
    removals.map((label) => {
      const target = targetOf(label);
      const event = resolved.get(label.id) ?? lookup(target);
      return {
        label,
        event,
        title: event
          ? getFeedCardData(event).title
          : m.community_removed_content_unknown_item({ kind: String(target?.kind ?? '?') })
      };
    })
  );

  /** @param {any} label */
  async function restore(label) {
    if (busyId) return;
    busyId = label.id;
    try {
      await onRestore(label);
      showToast(m.community_removed_content_restored(), 'success');
    } catch (err) {
      showToast(
        m.community_removed_content_restore_failed({
          error: err instanceof Error ? err.message : String(err)
        }),
        'error'
      );
    } finally {
      busyId = null;
    }
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="removed-content-pane">
  <div class="card-body">
    <h2 class="card-title">{m.community_removed_content_title()}</h2>
    <p class="text-sm text-base-content/70">{m.community_removed_content_description()}</p>
    {#if rows.length === 0}
      <p class="mt-2 text-sm text-base-content/60">{m.community_removed_content_empty()}</p>
    {:else}
      <ul class="mt-2 divide-y divide-base-300">
        <!-- Keyed by the label's event id: unique by construction. -->
        {#each rows as row (row.label.id)}
          <li class="flex items-center justify-between gap-3 py-3">
            <div class="min-w-0">
              <p class="truncate font-medium" title={row.title}>{row.title}</p>
              <p class="text-xs text-base-content/60">
                {m.community_removed_content_by({
                  name: getUserDisplayName(row.label.pubkey, getProfiles().get(row.label.pubkey)),
                  date: formatTimestamp(row.label.created_at)
                })}
              </p>
            </div>
            {#if canRestoreRemoval(row.label)}
              <button
                class="btn shrink-0 btn-outline btn-sm"
                onclick={() => restore(row.label)}
                disabled={busyId !== null}
              >
                {#if busyId === row.label.id}
                  <span class="loading loading-xs loading-spinner"></span>
                {/if}
                {m.community_removed_content_restore()}
              </button>
            {:else}
              <span class="shrink-0 text-xs text-base-content/50">
                {m.community_removed_content_restore_locked()}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
