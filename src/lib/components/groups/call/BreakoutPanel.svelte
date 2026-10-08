<!--
  BreakoutPanel — the host's view of a running breakout session, in the
  stage's side column: every room with the people seated in it (kind 39002
  rosters; a badge for those the relay sees live in the room's call, kind
  39004), a "Verschieben nach …" picker per person, "Beitreten" per room,
  the people still in the main room with the same picker, the deadline with
  "+5 Min", the late-joiner switch ("Nachzügler automatisch verteilen") and
  "Alle zurückholen" (= delete every room, everyone returns).

  Pure view: the breakout store (groups/breakout.svelte.js) owns the session;
  the callbacks are the stage's. Names come from the profile map — people in
  a room are no longer LiveKit participants of the main room.
-->
<script>
  import { CloseIcon, MeetIcon } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { BREAKOUT_EXTEND_MINUTES, formatCountdown, roomOfPubkey } from '$lib/groups/breakout.js';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {import('$lib/groups/call-participants.js').ParticipantRow} ParticipantRow */
  /** @typedef {import('$lib/groups/breakout.svelte.js').BreakoutRoom} BreakoutRoom */
  /**
   * @type {{
   *   rows: ParticipantRow[],
   *   breakout: ReturnType<typeof import('$lib/groups/breakout.svelte.js').getBreakoutState>,
   *   myPubkey: string | null,
   *   onMove: (args: {pubkey: string, identities: string[], toRoomId: string | null}) => void,
   *   onJoin: (room: BreakoutRoom) => void,
   *   onEnd: () => void,
   *   onExtend: (minutes: number) => void,
   *   onAutoAssign: (enabled: boolean) => void,
   *   onClose: () => void
   * }}
   */
  let { rows, breakout, myPubkey, onMove, onJoin, onEnd, onExtend, onAutoAssign, onClose } =
    $props();

  const rooms = $derived(breakout.rooms);
  /** Seated people per room, the host (a member of every room) left out. */
  const seatedByRoom = $derived.by(() => {
    /** @type {Record<string, string[]>} */
    const out = {};
    for (const room of rooms) {
      out[room.id] = [...(breakout.membersByRoomId[room.id] ?? [])].filter(
        (pubkey) => pubkey !== myPubkey
      );
    }
    return out;
  });
  /** Main-room seats that can be sent somewhere: remote members not in a room. */
  const inMain = $derived(
    rows.filter(
      (row) =>
        !row.isLocal &&
        !row.guest &&
        !!row.pubkey &&
        !roomOfPubkey(rooms, breakout.membersByRoomId, /** @type {string} */ (row.pubkey))
    )
  );
  const getProfiles = useProfileMap(() => [
    ...Object.values(seatedByRoom).flat(),
    ...inMain.map((row) => /** @type {string} */ (row.pubkey))
  ]);
  /** @param {string} pubkey */
  const nameOf = (pubkey) => getUserDisplayName(pubkey, getProfiles().get(pubkey));
  /** @param {string} roomId @param {string} pubkey */
  const live = (roomId, pubkey) => breakout.presenceByRoomId[roomId]?.includes(pubkey) === true;
  /** Every seat of this pubkey in the main room (a user may sit there twice). @param {string} pubkey */
  const identitiesOf = (pubkey) =>
    rows.filter((row) => row.pubkey === pubkey).map((row) => row.participant.identity);

  /** @param {string} pubkey @param {Event} event */
  function move(pubkey, event) {
    const value = /** @type {HTMLSelectElement} */ (event.currentTarget).value;
    onMove({ pubkey, identities: identitiesOf(pubkey), toRoomId: value === '' ? null : value });
    /** @type {HTMLSelectElement} */ (event.currentTarget).value = '__pick';
  }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="breakout-panel">
  <div class="flex shrink-0 items-center gap-2 border-b border-base-300 px-3 py-2">
    <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">{m.groups_call_breakout_title()}</h3>
    {#if breakout.remaining !== null}
      <span class="badge badge-sm tabular-nums badge-warning" data-testid="breakout-panel-deadline">
        {m.groups_call_breakout_time_left({ time: formatCountdown(breakout.remaining) })}
      </span>
    {/if}
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      onclick={() => onExtend(BREAKOUT_EXTEND_MINUTES)}
      disabled={breakout.busy}
      title={m.groups_call_breakout_duration()}
      data-testid="breakout-panel-extend"
    >
      {m.groups_call_breakout_extend({ minutes: BREAKOUT_EXTEND_MINUTES })}
    </button>
    <button
      type="button"
      class="btn btn-square btn-ghost btn-sm"
      onclick={onClose}
      aria-label={m.common_close()}
      data-testid="breakout-panel-close"
    >
      <CloseIcon class_="h-4 w-4" title="" />
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
    {#each rooms as room (room.id)}
      <section class="mb-3" data-testid="breakout-panel-room">
        <div class="flex items-center gap-2">
          <h4 class="min-w-0 flex-1 truncate font-medium">
            {m.groups_call_breakout_room_label({ n: room.index })}
          </h4>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => onJoin(room)}
            disabled={breakout.busy}
            data-testid="breakout-panel-join"
          >
            <MeetIcon class_="h-4 w-4" title="" />
            {m.groups_call_breakout_join()}
          </button>
        </div>
        {#if seatedByRoom[room.id].length === 0}
          <p class="px-1 text-xs text-base-content/60">{m.groups_call_breakout_empty_room()}</p>
        {:else}
          <ul>
            {#each seatedByRoom[room.id] as pubkey (pubkey)}
              <li class="flex items-center gap-2 py-1" data-testid="breakout-panel-member">
                <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="xs" />
                <span class="min-w-0 flex-1 truncate">{nameOf(pubkey)}</span>
                {#if live(room.id, pubkey)}
                  <span class="badge badge-ghost badge-xs" data-testid="breakout-panel-live">
                    {m.groups_call_breakout_in_call_badge()}
                  </span>
                {/if}
                <select
                  class="select-bordered select max-w-32 select-xs"
                  value="__pick"
                  disabled={breakout.busy}
                  onchange={(e) => move(pubkey, e)}
                  aria-label={m.groups_call_breakout_move_to()}
                  data-testid="breakout-panel-move"
                >
                  <option value="__pick" disabled>{m.groups_call_breakout_move_to()}</option>
                  <option value="">{m.groups_call_breakout_main_room()}</option>
                  {#each rooms.filter((r) => r.id !== room.id) as other (other.id)}
                    <option value={other.id}>
                      {m.groups_call_breakout_room_label({ n: other.index })}
                    </option>
                  {/each}
                </select>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}

    <section class="mb-3" data-testid="breakout-panel-main">
      <h4 class="font-medium">{m.groups_call_breakout_members_in_main()}</h4>
      {#if inMain.length === 0}
        <p class="px-1 text-xs text-base-content/60">{m.groups_call_breakout_empty_room()}</p>
      {:else}
        <ul>
          {#each inMain as row (row.key)}
            <li class="flex items-center gap-2 py-1" data-testid="breakout-panel-main-member">
              <ProfileAvatar pubkey={row.pubkey ?? undefined} profile={row.profile} size="xs" />
              <span class="min-w-0 flex-1 truncate">
                {nameOf(/** @type {string} */ (row.pubkey))}
              </span>
              <select
                class="select-bordered select max-w-32 select-xs"
                value="__pick"
                disabled={breakout.busy}
                onchange={(e) => move(/** @type {string} */ (row.pubkey), e)}
                aria-label={m.groups_call_breakout_move_to()}
                data-testid="breakout-panel-move"
              >
                <option value="__pick" disabled>{m.groups_call_breakout_move_to()}</option>
                {#each rooms as other (other.id)}
                  <option value={other.id}>
                    {m.groups_call_breakout_room_label({ n: other.index })}
                  </option>
                {/each}
              </select>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <label class="mb-2 flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        checked={breakout.session?.autoAssign === true}
        onchange={(e) => onAutoAssign(/** @type {HTMLInputElement} */ (e.currentTarget).checked)}
        data-testid="breakout-panel-auto-assign"
      />
      <span>{m.groups_call_breakout_auto_assign()}</span>
    </label>
    <p class="text-xs text-base-content/60">{m.groups_call_breakout_panel_hint()}</p>
    <p class="mt-1 text-xs text-base-content/60">{m.groups_call_breakout_host_note()}</p>
  </div>

  <div class="shrink-0 border-t border-base-300 p-2">
    <button
      type="button"
      class="btn w-full btn-sm btn-primary"
      onclick={onEnd}
      disabled={breakout.busy}
      data-testid="breakout-panel-end"
    >
      {#if breakout.busy}
        <span class="loading loading-xs loading-spinner"></span>
        {m.groups_call_breakout_ending()}
      {:else}
        {m.groups_call_breakout_end_all()}
      {/if}
    </button>
  </div>
</div>
