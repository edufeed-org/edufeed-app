<!--
  AreaMembersModal — Task 5. Area-level member management across a
  community's Stufe-2 ("members") NIP-29 channels: a client-side promise
  (NIP-29 has no cascade — see area-members.js) that everyone in the area's
  shared channels stays in every one of them. Renders the UNION of those
  channels' rosters, flags anyone missing from at least one, and lets an
  admin repair a single row, remove a row from every channel it's in, or add
  a new member to every Stufe-2 channel at once.

  Admin capability is per-channel (acting user in that channel's 39001, from
  useChannelRosters' adminsByKey) — action buttons render only when the user
  is admin in at least one of the row/add operation's TARGET channels, not
  merely admin somewhere in the community.

  No local roster mutation: every fan-out ends with rosters().refresh() —
  same "relay is the only source of truth" rule as GroupMembersModal.
-->
<script>
  import {
    stufe2Pointers,
    areaMemberRows,
    fanOutPlan,
    aggregateFanOut
  } from '$lib/groups/area-members.js';
  import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
  import {
    buildPutUserTemplate,
    buildRemoveUserTemplate,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { uniqueBy } from '$lib/helpers/unique.js';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /** @type {{communikeyEvent: {tags?: string[][]} | null | undefined, onClose: () => void}} */
  let { communikeyEvent, onClose } = $props();

  const getActiveUser = useActiveUser();

  // Duplicate `group` tags with the same channelKey are untrusted tag input
  // (a malformed/hand-edited 10222 can repeat one) and would otherwise
  // double every fan-out target — dedupe once, right where pointers enter
  // this modal.
  const pointers = $derived(uniqueBy(stufe2Pointers(communikeyEvent), (p) => channelKey(p)));
  const pointerKeys = $derived(
    pointers.map((pointer) => channelKey(pointer)).filter((key) => key !== null)
  );

  const getRosters = useChannelRosters(() => pointers);

  const rows = $derived(areaMemberRows({ pointers, membersByKey: getRosters().membersByKey }));

  const getProfiles = useProfileMap(() => rows.map((row) => row.pubkey));

  /** Channel key -> display name, for the deviation badge's title. */
  const nameByKey = $derived.by(() => {
    /** @type {Map<string, string>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain accumulator local to this derivation, never held in $state
    const map = new Map();
    for (const pointer of pointers) {
      const key = channelKey(pointer);
      if (key) map.set(key, pointer.name || pointer.id);
    }
    return map;
  });

  /** @param {string[]} keys */
  function channelNames(keys) {
    return keys.map((key) => nameByKey.get(key) ?? key).join(', ');
  }

  const myPubkey = $derived(getActiveUser()?.pubkey);
  const adminChannelKeys = $derived.by(() => {
    /** @type {Set<string>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain accumulator local to this derivation, never held in $state
    const keys = new Set();
    const my = myPubkey;
    if (!my) return keys;
    for (const [key, admins] of Object.entries(getRosters().adminsByKey)) {
      if (admins.some((admin) => admin.pubkey === my)) keys.add(key);
    }
    return keys;
  });

  /** @param {string[]} keys */
  function canActOn(keys) {
    return keys.some((key) => adminChannelKeys.has(key));
  }

  const isAdminSomewhere = $derived(canActOn(pointerKeys));

  let busy = $state(false);

  /**
   * Try `action(pointer)` once, then once more on failure. Never throws — a
   * NIP-29 relay refusing one channel (not admin there, offline, etc.) must
   * not blind the rest of the fan-out or leave an unhandled rejection behind.
   * @param {{id: string, relay: string}} pointer
   * @param {(pointer: {id: string, relay: string}) => Promise<any>} action
   */
  async function tryOnce(pointer, action) {
    try {
      await action(pointer);
      return true;
    } catch (err) {
      console.warn('groups: area fan-out action failed, retrying once', channelKey(pointer), err);
      try {
        await action(pointer);
        return true;
      } catch (err2) {
        console.error('groups: area fan-out retry failed', channelKey(pointer), err2);
        return false;
      }
    }
  }

  /**
   * @param {Array<{id: string, relay: string}>} targetPointers
   * @param {(pointer: {id: string, relay: string}) => Promise<any>} action
   */
  async function fanOut(targetPointers, action) {
    const results = [];
    for (const pointer of targetPointers) {
      const ok = await tryOnce(pointer, action);
      results.push({ key: channelKey(pointer) ?? pointer.id, ok });
    }
    return aggregateFanOut(results);
  }

  /**
   * @param {{ok: string[], failed: string[]}} aggregate
   * @param {(count: number) => string} successMessage
   */
  function reportFanOut(aggregate, successMessage) {
    if (aggregate.failed.length === 0) {
      showToast(successMessage(aggregate.ok.length), 'success');
    } else {
      const total = aggregate.ok.length + aggregate.failed.length;
      showToast(
        m.area_members_fanout_partial({ failed: aggregate.failed.length, total }),
        'warning'
      );
    }
    getRosters().refresh();
  }

  /** @param {{id: string, relay: string}} pointer @param {string} pubkey @param {string[]} [roles] */
  function putUserOn(pointer, pubkey, roles = []) {
    const user = getActiveUser();
    if (!user) return Promise.reject(new Error('no active user'));
    return publishToGroupRelay(
      pool.relay(pointer.relay),
      buildPutUserTemplate(pointer.id, pubkey, roles),
      user
    );
  }

  /** @param {{id: string, relay: string}} pointer @param {string} pubkey */
  function removeUserOn(pointer, pubkey) {
    const user = getActiveUser();
    if (!user) return Promise.reject(new Error('no active user'));
    return publishToGroupRelay(
      pool.relay(pointer.relay),
      buildRemoveUserTemplate(pointer.id, pubkey),
      user
    );
  }

  /** @param {{pubkey: string, inKeys: string[], missingKeys: string[]}} row */
  async function repair(row) {
    if (busy || !getActiveUser()) return;
    const targets = fanOutPlan({
      pubkey: row.pubkey,
      pointers,
      membersByKey: getRosters().membersByKey
    });
    if (targets.length === 0) return;
    busy = true;
    try {
      const aggregate = await fanOut(targets, (pointer) => putUserOn(pointer, row.pubkey));
      reportFanOut(aggregate, (count) => m.area_members_fanout_ok({ count }));
    } finally {
      busy = false;
    }
  }

  /** @param {{pubkey: string, inKeys: string[], missingKeys: string[]}} row */
  async function removeRow(row) {
    if (busy || !getActiveUser()) return;
    const inKeys = new Set(row.inKeys);
    const targets = pointers.filter((pointer) => {
      const key = channelKey(pointer);
      return key !== null && inKeys.has(key);
    });
    if (targets.length === 0) return;
    busy = true;
    try {
      const aggregate = await fanOut(targets, (pointer) => removeUserOn(pointer, row.pubkey));
      reportFanOut(aggregate, (count) => m.area_members_removed({ count }));
    } finally {
      busy = false;
    }
  }

  /** @param {string} pubkey */
  async function addMember(pubkey) {
    if (busy || !getActiveUser() || pointers.length === 0) return;
    busy = true;
    try {
      const aggregate = await fanOut(pointers, (pointer) => putUserOn(pointer, pubkey));
      reportFanOut(aggregate, (count) => m.area_members_fanout_ok({ count }));
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-lg font-extrabold">{m.area_members_title()}</h3>
    <p class="mb-1 text-xs text-base-content/60">{m.area_members_lead()}</p>

    <div class="divide-y divide-base-300">
      {#each rows as row (row.pubkey)}
        <div
          class="flex flex-wrap items-center gap-3 py-2"
          data-testid="area-member-row"
          data-pubkey={row.pubkey}
        >
          <ProfileAvatar pubkey={row.pubkey} profile={getProfiles().get(row.pubkey)} size="sm" />
          <span class="flex-1 truncate text-sm font-semibold">
            {getUserDisplayName(row.pubkey, getProfiles().get(row.pubkey))}
          </span>
          {#if row.missingKeys.length > 0}
            <span
              class="badge max-w-[10rem] truncate badge-sm badge-warning"
              data-testid="area-member-deviation"
              title={channelNames(row.missingKeys)}
            >
              {m.area_members_missing({ count: row.missingKeys.length })}
            </span>
          {/if}
          {#if row.missingKeys.length > 0 && canActOn(row.missingKeys)}
            <button
              class="btn btn-ghost btn-xs"
              data-testid="area-member-repair"
              data-pubkey={row.pubkey}
              disabled={busy}
              onclick={() => repair(row)}
            >
              {m.area_members_repair()}
            </button>
          {/if}
          {#if canActOn(row.inKeys)}
            <button
              class="btn text-error btn-ghost btn-xs"
              data-testid="area-member-remove"
              data-pubkey={row.pubkey}
              disabled={busy}
              onclick={() => removeRow(row)}
            >
              {m.area_members_remove()}
            </button>
          {/if}
        </div>
      {/each}
    </div>

    {#if isAdminSomewhere}
      <div class="mt-3">
        <ContactSearchInput
          acceptPubkeyInput
          disabled={busy}
          placeholder={m.area_members_add_placeholder()}
          exclude={rows.map((row) => row.pubkey)}
          onselect={(/** @type {{ pubkey: string }} */ c) => addMember(c.pubkey)}
          onrawpubkey={(/** @type {string} */ hex) => addMember(hex)}
        />
      </div>
    {/if}
  </div>
</div>
