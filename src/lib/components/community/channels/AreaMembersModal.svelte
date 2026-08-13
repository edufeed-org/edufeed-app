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
  import { stufe2Pointers, areaMemberRows, fanOutPlan } from '$lib/groups/area-members.js';
  import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
  import { putUserOn, removeUserOn, fanOut } from '$lib/groups/roster-fanout.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
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

  // adminsByKey folded in (handoff #11d): an admin implicitly belongs to
  // their own channel even without an explicit 39002 entry, so they must
  // not read as a deviation, and a sync/repair fan-out must not "fix" them.
  const rows = $derived(
    areaMemberRows({
      pointers,
      membersByKey: getRosters().membersByKey,
      adminsByKey: getRosters().adminsByKey
    })
  );

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

  // (pubkey, channelKey) pairs an explicit "Remove" was fired for, this
  // modal session (handoff #11a — scoped to the exact channel per review
  // follow-up, NOT the bare pubkey: a removal from channel X must not
  // suppress an unrelated, later deviation on channel Z for the same
  // person). A partial removal leaves the row LOOKING like an ordinary
  // deviation on X once the roster refreshes (present in the channels the
  // removal failed on, absent from X) — but offering "Repair" for X there
  // would fan out put-user right back into the channel the admin just
  // removed them from, undoing the very action they took. This set is the
  // only thing standing between that data shape and the contradictory
  // prompt, since the roster itself carries no memory of "removed on
  // purpose". $state.raw + full reassignment (Set, per the project's
  // $state.raw rule for Set/Map — see CLAUDE.md).
  /** @type {Set<string>} */
  let recentlyRemoved = $state.raw(new Set());

  /** @param {string} pubkey @param {string} key */
  function removalKey(pubkey, key) {
    return `${pubkey}\x1f${key}`;
  }

  /** The row's missing channels minus the ones just removed from — those
   * stay reparable (handoff #11a's suppression is per-channel, not per-row).
   * @param {{pubkey: string, missingKeys: string[]}} row */
  function reparableMissingKeys(row) {
    return row.missingKeys.filter((key) => !recentlyRemoved.has(removalKey(row.pubkey, key)));
  }

  /** @param {{pubkey: string, missingKeys: string[]}} row */
  function rowOffersRepair(row) {
    return reparableMissingKeys(row).length > 0;
  }

  // Bulk "Check members" affordance: visible once at least one row has a
  // reparable deviation the acting user is admin enough to fix (union over
  // every row's reparable missingKeys, not just any one row) — excluding
  // channels an explicit remove was just fired for, same reasoning as
  // rowOffersRepair.
  const canSyncAny = $derived(
    rows.some((row) => rowOffersRepair(row) && canActOn(reparableMissingKeys(row)))
  );

  let busy = $state(false);

  /**
   * @param {{ok: string[], failed: string[]}} aggregate
   * @param {(count: number) => string} successMessage
   * @param {(aggregate: {ok: string[], failed: string[]}, total: number) => string} [partialMessage]
   */
  function reportFanOut(
    aggregate,
    successMessage,
    partialMessage = (agg, total) =>
      m.area_members_fanout_partial({ failed: agg.failed.length, total })
  ) {
    if (aggregate.failed.length === 0) {
      showToast(successMessage(aggregate.ok.length), 'success');
    } else {
      const total = aggregate.ok.length + aggregate.failed.length;
      showToast(partialMessage(aggregate, total), 'warning');
    }
    getRosters().refresh();
  }

  /** @param {{pubkey: string, inKeys: string[], missingKeys: string[]}} row */
  async function repair(row) {
    if (busy || !getActiveUser()) return;
    const reparable = new Set(reparableMissingKeys(row));
    const targets = fanOutPlan({
      pubkey: row.pubkey,
      pointers,
      membersByKey: getRosters().membersByKey,
      adminsByKey: getRosters().adminsByKey
    }).filter((pointer) => reparable.has(channelKey(pointer) ?? ''));
    if (targets.length === 0) return;
    busy = true;
    try {
      const aggregate = await fanOut(
        targets,
        (pointer) => channelKey(pointer) ?? pointer.id,
        (pointer) => putUserOn(pointer, row.pubkey, [], /** @type {any} */ (getActiveUser()))
      );
      reportFanOut(aggregate, (count) => m.area_members_fanout_ok({ count }));
    } finally {
      busy = false;
    }
  }

  /**
   * @param {{pubkey: string, inKeys: string[], memberKeys: string[], adminOnlyKeys: string[], missingKeys: string[]}} row
   */
  async function removeRow(row) {
    if (busy || !getActiveUser()) return;
    // Target ONLY memberKeys: kind-9001 remove-user is a no-op for a pubkey
    // with no 39002 entry — the relay OKs it, the roster stays unchanged,
    // and admin rights on adminOnlyKeys survive untouched. Fanning that out
    // over the union (inKeys) would silently do nothing there while a
    // generic success toast implied the removal was complete (review
    // finding — the default state of every members-tier channel's founder,
    // since the create wizard filters self out of its own put-user
    // fan-out).
    const memberSet = new Set(row.memberKeys);
    const targets = pointers.filter((pointer) => {
      const key = channelKey(pointer);
      return key !== null && memberSet.has(key);
    });
    const adminOnlyNote =
      row.adminOnlyKeys.length > 0
        ? m.area_members_admin_only_note({ channels: channelNames(row.adminOnlyKeys) })
        : null;
    if (targets.length === 0) {
      // Nothing to remove via membership — still tell the admin about the
      // admin-only channels instead of a silent no-op.
      if (adminOnlyNote) showToast(adminOnlyNote, 'warning');
      return;
    }
    busy = true;
    // Mark BEFORE the fan-out settles: removal was the explicit intent for
    // every target regardless of outcome, so the repair prompt must not
    // flash on for the successes while the failures are still in flight.
    // Keyed per (pubkey, channel) — see recentlyRemoved's own comment.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw + full reassignment, per CLAUDE.md's Set/Map rule
    const nextRemoved = new Set(recentlyRemoved);
    for (const pointer of targets) {
      const key = channelKey(pointer);
      if (key) nextRemoved.add(removalKey(row.pubkey, key));
    }
    recentlyRemoved = nextRemoved;
    try {
      const aggregate = await fanOut(
        targets,
        (pointer) => channelKey(pointer) ?? pointer.id,
        (pointer) => removeUserOn(pointer, row.pubkey, /** @type {any} */ (getActiveUser()))
      );
      // A refused removal can't point at the badges the way add/repair do
      // (handoff #11a hides the deviation badge's repair action for exactly
      // these rows) — name the refusing channels in the toast text instead
      // (handoff #11b, parity with add's informational value).
      reportFanOut(
        aggregate,
        (count) => m.area_members_removed({ count }),
        (agg, total) =>
          m.area_members_fanout_partial_removed({
            failed: agg.failed.length,
            total,
            names: channelNames(agg.failed)
          })
      );
      // Surfaced AFTER the removal toast, not instead of it — the two say
      // different things (what happened to the memberships vs. what could
      // not be touched at all) and both matter.
      if (adminOnlyNote) showToast(adminOnlyNote, 'warning');
    } finally {
      busy = false;
    }
  }

  /** @param {string} pubkey */
  async function addMember(pubkey) {
    if (busy || !getActiveUser() || pointers.length === 0) return;
    busy = true;
    // An explicit add is the opposite intent of an earlier remove — a
    // pubkey re-added here should be eligible for "Repair" again on every
    // channel if a future deviation shows up (composite keys, so this
    // clears all of THIS pubkey's suppressed channels, not other pubkeys').
    const prefix = `${pubkey}\x1f`;
    if ([...recentlyRemoved].some((entry) => entry.startsWith(prefix))) {
      recentlyRemoved = new Set([...recentlyRemoved].filter((entry) => !entry.startsWith(prefix)));
    }
    try {
      const aggregate = await fanOut(
        pointers,
        (pointer) => channelKey(pointer) ?? pointer.id,
        (pointer) => putUserOn(pointer, pubkey, [], /** @type {any} */ (getActiveUser()))
      );
      reportFanOut(aggregate, (count) => m.area_members_fanout_ok({ count }));
    } finally {
      busy = false;
    }
  }

  /**
   * Bulk "Check members" — repairs every row's deviations in one pass:
   * gathers each row's fanOutPlan targets into a single flat list of
   * {pointer, pubkey} pairs, runs them through ONE fanOut (still one relay
   * publish at a time, still per-item retry), and reports ONE combined
   * toast + refresh instead of one per row.
   */
  async function syncAll() {
    if (busy || !getActiveUser()) return;
    /** @type {Array<{pointer: {id: string, relay: string}, pubkey: string}>} */
    const items = [];
    for (const row of rows) {
      const reparable = new Set(reparableMissingKeys(row));
      if (reparable.size === 0) continue;
      const targets = fanOutPlan({
        pubkey: row.pubkey,
        pointers,
        membersByKey: getRosters().membersByKey,
        adminsByKey: getRosters().adminsByKey
      }).filter((pointer) => reparable.has(channelKey(pointer) ?? ''));
      for (const pointer of targets) items.push({ pointer, pubkey: row.pubkey });
    }
    if (items.length === 0) return;
    busy = true;
    try {
      const aggregate = await fanOut(
        items,
        (item) => `${channelKey(item.pointer) ?? item.pointer.id}:${item.pubkey}`,
        (item) => putUserOn(item.pointer, item.pubkey, [], /** @type {any} */ (getActiveUser()))
      );
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

    {#if canSyncAny}
      <button
        class="btn mb-1 btn-outline btn-sm"
        data-testid="area-members-sync"
        disabled={busy}
        onclick={syncAll}
      >
        {m.area_members_sync()}
      </button>
    {/if}

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
          {#if rowOffersRepair(row) && canActOn(reparableMissingKeys(row))}
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
