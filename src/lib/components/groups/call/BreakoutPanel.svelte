<!--
  BreakoutPanel — the host's view of a running breakout session, in the
  stage's side column: every room with the people seated in it (kind 39002
  rosters; a badge for those the relay sees live in the room's call, kind
  39004) and the GUESTS in it (live in the room's call without a roster
  seat — a call pass opens the room; "Gast" badge), a "Verschieben nach …"
  picker per person, "Beitreten" per room, the people still in the main
  room with the same picker, the deadline menu ("Noch m:ss" → +5/10/15 Min
  or "Zeitlimit entfernen"; "Kein Zeitlimit" → "In N Min beenden" or an
  own number of minutes), the late-joiner switch ("Nachzügler automatisch
  verteilen") and "Alle zurückholen"
  (= delete every room, everyone returns). A guest's picker reports
  `guest: true`: the store moves it by message and the moderation
  endpoint, never with put-user.

  Pure view: the breakout store (groups/breakout.svelte.js) owns the session;
  the callbacks are the stage's. Names come from the profile map — people in
  a room are no longer LiveKit participants of the main room.
-->
<script>
  import { ChevronDownIcon, CloseIcon, MeetIcon, SendIcon } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { formatCountdown, roomOfPubkey } from '$lib/groups/breakout.js';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {import('$lib/groups/call-participants.js').ParticipantRow} ParticipantRow */
  /** @typedef {import('$lib/groups/breakout.svelte.js').BreakoutRoom} BreakoutRoom */
  /**
   * @type {{
   *   rows: ParticipantRow[],
   *   breakout: ReturnType<typeof import('$lib/groups/breakout.svelte.js').getBreakoutState>,
   *   myPubkey: string | null,
   *   onMove: (args: {pubkey: string, identities: string[], toRoomId: string | null, guest?: boolean}) => void,
   *   onJoin: (room: BreakoutRoom) => void,
   *   onEnd: (opts: {notify: boolean}) => void,
   *   onExtend: (minutes: number) => void,
   *   onSetDeadline: (minutesFromNow: number | null) => void,
   *   onAutoAssign: (enabled: boolean) => void,
   *   onBroadcast: (text: string) => Promise<boolean>,
   *   onClose: () => void,
   *   compact?: boolean
   * }}
   */
  let {
    rows,
    breakout,
    myPubkey,
    onMove,
    onJoin,
    onEnd,
    onExtend,
    onSetDeadline,
    onAutoAssign,
    onBroadcast,
    onClose,
    compact = false
  } = $props();

  // "Nachricht an alle Räume": a kind-20002 call broadcast through the
  // relay (groups/call-broadcasts.js). The draft stays when the relay
  // refuses it (the store toasts the reason).
  let broadcastDraft = $state('');
  let broadcastBusy = $state(false);
  async function sendBroadcast() {
    const text = broadcastDraft.trim();
    if (!text || broadcastBusy) return;
    broadcastBusy = true;
    try {
      if (await onBroadcast(text)) broadcastDraft = '';
    } finally {
      broadcastBusy = false;
    }
  }
  // The deadline menu: "+N Min" / "Zeitlimit entfernen" while one runs,
  // "In N Min beenden" / "Eigene Dauer …" (a minutes input) without one. A
  // click outside (in the panel's own document — the pop-out has its own)
  // or Escape closes it; the input stays until set or closed.
  const DEADLINE_STEPS = [5, 10, 15];
  const CUSTOM_MIN = 1;
  const CUSTOM_MAX = 180;
  /** @type {HTMLDivElement | undefined} */
  let deadlineMenuEl = $state(undefined);
  let deadlineMenuOpen = $state(false);
  let customOpen = $state(false);
  let customMinutes = $state('');
  const customValue = $derived(Number(customMinutes));
  const customValid = $derived(
    Number.isInteger(customValue) && customValue >= CUSTOM_MIN && customValue <= CUSTOM_MAX
  );
  function closeDeadlineMenu() {
    deadlineMenuOpen = false;
    customOpen = false;
    customMinutes = '';
  }
  /** @param {number} minutes */
  function extend(minutes) {
    closeDeadlineMenu();
    onExtend(minutes);
  }
  /** @param {number | null} minutes */
  function setDeadline(minutes) {
    closeDeadlineMenu();
    onSetDeadline(minutes);
  }
  function setCustom() {
    if (!customValid) return;
    setDeadline(customValue);
  }
  $effect(() => {
    if (!deadlineMenuOpen) return;
    const win = deadlineMenuEl?.ownerDocument.defaultView;
    if (!win) return;
    /** @param {PointerEvent} event */
    const onPointerDown = (event) => {
      const target = /** @type {Node | null} */ (event.target);
      if (target && !deadlineMenuEl?.contains(target)) closeDeadlineMenu();
    };
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeDeadlineMenu();
    };
    win.addEventListener('pointerdown', onPointerDown);
    win.addEventListener('keydown', onKeyDown);
    return () => {
      win.removeEventListener('pointerdown', onPointerDown);
      win.removeEventListener('keydown', onKeyDown);
    };
  });
  // "Alle zurückholen" asks first, with the optional `return` heads-up.
  let endConfirmOpen = $state(false);
  let endNotify = $state(true);
  function confirmEnd() {
    endConfirmOpen = false;
    onEnd({ notify: endNotify });
  }

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
  /**
   * Guests per room: live in the room's call (39004) without a roster seat
   * there (guests are on no roster) and not us. A guest that announced its
   * seat (`guestSeats`) counts too, so it is listed before the relay's
   * first 39004 arrives.
   */
  const guestsByRoom = $derived.by(() => {
    /** @type {Record<string, string[]>} */
    const out = {};
    for (const room of rooms) {
      const seated = breakout.membersByRoomId[room.id] ?? new Set();
      const announced = Object.entries(breakout.guestSeats ?? {})
        .filter(([, seat]) => seat.roomId === room.id)
        .map(([pubkey]) => pubkey);
      out[room.id] = [
        ...new Set([...(breakout.presenceByRoomId[room.id] ?? []), ...announced])
      ].filter((pubkey) => pubkey !== myPubkey && !seated.has(pubkey));
    }
    return out;
  });
  /** Main-room seats that can be sent somewhere: remote members not in a room, and guests. */
  const inMain = $derived(
    rows.filter(
      (row) =>
        !row.isLocal &&
        !!row.pubkey &&
        !roomOfPubkey(rooms, breakout.membersByRoomId, /** @type {string} */ (row.pubkey))
    )
  );
  const getProfiles = useProfileMap(() => [
    ...Object.values(seatedByRoom).flat(),
    ...Object.values(guestsByRoom).flat(),
    ...inMain.map((row) => /** @type {string} */ (row.pubkey))
  ]);
  /** @param {string} pubkey */
  const nameOf = (pubkey) => getUserDisplayName(pubkey, getProfiles().get(pubkey));
  /** @param {string} roomId @param {string} pubkey */
  const live = (roomId, pubkey) => breakout.presenceByRoomId[roomId]?.includes(pubkey) === true;
  /** Every seat of this pubkey in the main room (a user may sit there twice). @param {string} pubkey */
  const identitiesOf = (pubkey) =>
    rows.filter((row) => row.pubkey === pubkey).map((row) => row.participant.identity);

  /** @param {string} pubkey @param {Event} event @param {boolean} [guest] */
  function move(pubkey, event, guest = false) {
    const value = /** @type {HTMLSelectElement} */ (event.currentTarget).value;
    onMove({
      pubkey,
      identities: identitiesOf(pubkey),
      toRoomId: value === '' ? null : value,
      ...(guest ? { guest: true } : {})
    });
    /** @type {HTMLSelectElement} */ (event.currentTarget).value = '__pick';
  }
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="breakout-panel">
  <!-- compact (inside the stage's tabbed drawer, design 1d): the tab row
    names the panel and carries the close, so this row keeps only the
    deadline control. -->
  <div class="flex shrink-0 items-center gap-2 border-b border-base-300 px-3 py-2">
    {#if !compact}
      <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
        {m.groups_call_breakout_title()}
      </h3>
    {:else}
      <span class="flex-1"></span>
    {/if}
    <div
      class="relative shrink-0"
      bind:this={deadlineMenuEl}
      data-testid="breakout-panel-deadline-menu"
    >
      <button
        type="button"
        class="btn gap-1 px-2 btn-ghost btn-sm {breakout.remaining !== null
          ? 'text-warning-content tabular-nums'
          : ''}"
        onclick={() => (deadlineMenuOpen ? closeDeadlineMenu() : (deadlineMenuOpen = true))}
        disabled={breakout.busy}
        aria-haspopup="menu"
        aria-expanded={deadlineMenuOpen}
        title={m.groups_call_breakout_deadline_menu()}
        data-testid="breakout-panel-deadline"
        data-deadline={breakout.remaining !== null ? 'set' : 'none'}
      >
        {#if breakout.remaining !== null}
          <span class="badge badge-sm tabular-nums badge-warning">
            {m.groups_call_breakout_time_left({ time: formatCountdown(breakout.remaining) })}
          </span>
        {:else}
          {m.groups_call_breakout_no_deadline()}
        {/if}
        <ChevronDownIcon class_="h-3 w-3" title="" />
      </button>
      {#if deadlineMenuOpen}
        <ul
          class="menu absolute top-full right-0 z-30 mt-1 w-56 rounded-box bg-base-100 p-2 shadow-lg"
          role="menu"
          data-testid="breakout-panel-deadline-options"
        >
          {#if breakout.remaining !== null}
            {#each DEADLINE_STEPS as minutes (minutes)}
              <li>
                <button
                  type="button"
                  class="text-sm"
                  role="menuitem"
                  onclick={() => extend(minutes)}
                  data-testid="breakout-panel-extend"
                  data-minutes={minutes}
                >
                  {m.groups_call_breakout_extend({ minutes })}
                </button>
              </li>
            {/each}
            <li>
              <button
                type="button"
                class="text-sm"
                role="menuitem"
                onclick={() => setDeadline(null)}
                data-testid="breakout-panel-clear-deadline"
              >
                {m.groups_call_breakout_clear_deadline()}
              </button>
            </li>
          {:else}
            {#each DEADLINE_STEPS as minutes (minutes)}
              <li>
                <button
                  type="button"
                  class="text-sm"
                  role="menuitem"
                  onclick={() => setDeadline(minutes)}
                  data-testid="breakout-panel-end-in"
                  data-minutes={minutes}
                >
                  {m.groups_call_breakout_end_in({ minutes })}
                </button>
              </li>
            {/each}
            {#if customOpen}
              <li class="menu-title text-xs">{m.groups_call_breakout_custom_duration()}</li>
              <li class="pointer-events-auto">
                <form
                  class="flex items-center gap-1 p-1 hover:bg-transparent"
                  onsubmit={(e) => {
                    e.preventDefault();
                    setCustom();
                  }}
                  data-testid="breakout-panel-custom-form"
                >
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="number"
                    class="input-bordered input input-sm w-20 tabular-nums"
                    min={CUSTOM_MIN}
                    max={CUSTOM_MAX}
                    step="1"
                    inputmode="numeric"
                    bind:value={customMinutes}
                    aria-label={m.groups_call_breakout_custom_minutes()}
                    placeholder={m.groups_call_breakout_custom_minutes()}
                    autofocus
                    data-testid="breakout-panel-custom-minutes"
                  />
                  <button
                    type="submit"
                    class="btn btn-sm btn-primary"
                    disabled={!customValid}
                    data-testid="breakout-panel-custom-set"
                  >
                    {m.groups_call_breakout_set_deadline()}
                  </button>
                </form>
              </li>
            {:else}
              <li>
                <button
                  type="button"
                  class="text-sm"
                  role="menuitem"
                  onclick={() => (customOpen = true)}
                  data-testid="breakout-panel-custom-duration"
                >
                  {m.groups_call_breakout_custom_duration()}
                </button>
              </li>
            {/if}
          {/if}
        </ul>
      {/if}
    </div>
    {#if !compact}
      <button
        type="button"
        class="btn btn-square btn-ghost btn-sm"
        onclick={onClose}
        aria-label={m.common_close()}
        data-testid="breakout-panel-close"
      >
        <CloseIcon class_="h-4 w-4" title="" />
      </button>
    {/if}
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
        {#if seatedByRoom[room.id].length === 0 && guestsByRoom[room.id].length === 0}
          <p class="px-1 text-xs text-base-content/60">{m.groups_call_breakout_empty_room()}</p>
        {:else}
          <ul>
            {#each guestsByRoom[room.id] as pubkey (pubkey)}
              <li class="flex items-center gap-2 py-1" data-testid="breakout-panel-guest">
                <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="xs" />
                <span class="min-w-0 flex-1 truncate">{nameOf(pubkey)}</span>
                <span class="badge badge-ghost badge-xs">{m.groups_call_guest_badge()}</span>
                <select
                  class="select-bordered select max-w-32 select-xs"
                  value="__pick"
                  disabled={breakout.busy}
                  onchange={(e) => move(pubkey, e, true)}
                  aria-label={m.groups_call_breakout_move_to()}
                  data-testid="breakout-panel-move-guest"
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
              {#if row.guest}
                <span class="badge badge-ghost badge-xs" data-testid="breakout-panel-main-guest">
                  {m.groups_call_guest_badge()}
                </span>
              {/if}
              <select
                class="select-bordered select max-w-32 select-xs"
                value="__pick"
                disabled={breakout.busy}
                onchange={(e) => move(/** @type {string} */ (row.pubkey), e, row.guest === true)}
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
    <form
      class="mb-2 flex items-center gap-1"
      onsubmit={(e) => {
        e.preventDefault();
        void sendBroadcast();
      }}
      data-testid="breakout-panel-broadcast"
    >
      <input
        type="text"
        class="input-bordered input input-sm min-w-0 flex-1"
        bind:value={broadcastDraft}
        placeholder={m.groups_call_breakout_broadcast_placeholder()}
        aria-label={m.groups_call_breakout_broadcast_title()}
        maxlength="280"
        disabled={broadcastBusy}
        data-testid="breakout-panel-broadcast-input"
      />
      <button
        type="submit"
        class="btn btn-square btn-sm btn-primary"
        disabled={broadcastBusy || !broadcastDraft.trim()}
        aria-label={m.groups_call_breakout_broadcast_send()}
        title={m.groups_call_breakout_broadcast_title()}
        data-testid="breakout-panel-broadcast-send"
      >
        {#if broadcastBusy}
          <span class="loading loading-xs loading-spinner"></span>
        {:else}
          <SendIcon class_="h-4 w-4" title="" />
        {/if}
      </button>
    </form>
    <button
      type="button"
      class="btn w-full btn-sm btn-primary"
      onclick={() => (endConfirmOpen = true)}
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

{#if endConfirmOpen}
  <div
    class="modal-open modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="breakout-end-title"
    data-testid="breakout-end-confirm"
  >
    <div class="modal-box max-w-sm">
      <h3 id="breakout-end-title" class="font-bold">
        {m.groups_call_breakout_end_confirm_title()}
      </h3>
      <p class="py-2 text-sm">{m.groups_call_breakout_end_confirm_body()}</p>
      <label class="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          bind:checked={endNotify}
          data-testid="breakout-end-notify"
        />
        <span>{m.groups_call_breakout_end_notify()}</span>
      </label>
      <div class="modal-action">
        <button
          type="button"
          class="btn btn-ghost"
          onclick={() => (endConfirmOpen = false)}
          data-testid="breakout-end-cancel"
        >
          {m.common_cancel()}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={confirmEnd}
          data-testid="breakout-end-confirm-action"
        >
          {m.groups_call_breakout_end_all()}
        </button>
      </div>
    </div>
  </div>
{/if}
