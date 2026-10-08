<!--
  BreakoutDialog — the host opens breakout rooms: how many (2–8), random or
  manual assignment (a room picker per participant), an optional duration.
  Guests (call-pass seats) are listed greyed out: a pass does not extend to
  a sub-channel, so they stay in the main room. The host's own seat is not
  assigned either — the host stays to run the session (and may join a room
  from the panel afterwards).

  Pure form: `onStart` (the stage → breakout store) does the relay work and
  rejects with the relay's reason, which is shown here; on success the
  caller closes the dialog.
-->
<script>
  import { CloseIcon } from '$lib/components/icons';
  import { BREAKOUT_MIN_ROOMS, BREAKOUT_MAX_ROOMS, splitRandom } from '$lib/groups/breakout.js';
  import { isRelayMembershipRequired } from '$lib/groups/group-management.js';
  import { getBreakoutAutoAssign, setBreakoutAutoAssign } from '$lib/services/call-prefs.js';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {import('$lib/groups/call-participants.js').ParticipantRow} ParticipantRow */
  /**
   * @type {{
   *   rows: ParticipantRow[],
   *   nameOf: (row: ParticipantRow) => string,
   *   onStart: (args: {
   *     roomCount: number,
   *     seats: Array<{identity: string, pubkey: string, roomIndex: number}>,
   *     durationMinutes: number | null,
   *     autoAssign: boolean
   *   }) => Promise<void>,
   *   onClose: () => void
   * }}
   */
  let { rows, nameOf, onStart, onClose } = $props();

  let roomCount = $state(2);
  /** @type {'random' | 'manual'} */
  let mode = $state('random');
  /** @type {number | null} */
  let durationMinutes = $state(null);
  /** @type {Record<string, number>} seat key -> 1-based room (manual mode) */
  let manual = $state({});
  // "Nachzügler automatisch verteilen": whoever joins the main room while
  // the session runs is seated in the smallest room by the host's client.
  // Remembered on this device once chosen; until then it follows the mode
  // (on for a random split, off when the host places people by hand).
  /** @type {boolean | null} */
  let autoAssignChoice = $state(getBreakoutAutoAssign());
  const autoAssign = $derived(autoAssignChoice ?? mode === 'random');
  /** @param {boolean} enabled */
  function chooseAutoAssign(enabled) {
    autoAssignChoice = enabled;
    setBreakoutAutoAssign(enabled);
  }
  let busy = $state(false);
  /** @type {string | null} */
  let error = $state(null);

  // Everyone who can be sent to a room: a remote member seat with a pubkey.
  const assignable = $derived(rows.filter((row) => !row.isLocal && !row.guest && !!row.pubkey));
  const guests = $derived(rows.filter((row) => !row.isLocal && row.guest));
  const roomNumbers = $derived(Array.from({ length: roomCount }, (_, i) => i + 1));

  /** @param {ParticipantRow} row @param {number} n */
  function pick(row, n) {
    manual = { ...manual, [row.key]: n };
  }

  async function start() {
    if (busy) return;
    error = null;
    /** @type {Array<{identity: string, pubkey: string, roomIndex: number}>} */
    let seats;
    if (mode === 'random') {
      const buckets = splitRandom(assignable, roomCount);
      seats = buckets.flatMap((bucket, i) =>
        bucket.map((row) => ({
          identity: row.participant.identity,
          pubkey: /** @type {string} */ (row.pubkey),
          roomIndex: i + 1
        }))
      );
    } else {
      seats = assignable
        .filter((row) => (manual[row.key] ?? 0) >= 1)
        .map((row) => ({
          identity: row.participant.identity,
          pubkey: /** @type {string} */ (row.pubkey),
          roomIndex: manual[row.key]
        }));
    }
    busy = true;
    try {
      await onStart({
        roomCount,
        seats,
        durationMinutes: durationMinutes && durationMinutes > 0 ? durationMinutes : null,
        autoAssign
      });
    } catch (err) {
      console.warn('breakout start failed:', err);
      error = isRelayMembershipRequired(err)
        ? m.community_groups_relay_membership_required()
        : m.groups_call_breakout_failed({
            reason: err instanceof Error ? err.message : String(err)
          });
    } finally {
      busy = false;
    }
  }
</script>

<div
  class="modal-open modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="breakout-dialog-title"
  data-testid="breakout-dialog"
>
  <div class="modal-box flex max-h-[90vh] max-w-lg flex-col">
    <div class="flex items-center gap-2">
      <h3 id="breakout-dialog-title" class="flex-1 font-bold">{m.groups_call_breakout_title()}</h3>
      <button
        type="button"
        class="btn btn-square btn-ghost btn-sm"
        onclick={onClose}
        aria-label={m.common_close()}
        data-testid="breakout-dialog-close"
      >
        <CloseIcon class_="h-4 w-4" title="" />
      </button>
    </div>

    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      <label class="form-control">
        <span class="label-text text-sm">{m.groups_call_breakout_room_count()}</span>
        <select
          class="select-bordered select select-sm"
          bind:value={roomCount}
          data-testid="breakout-room-count"
        >
          {#each Array.from({ length: BREAKOUT_MAX_ROOMS - BREAKOUT_MIN_ROOMS + 1 }, (_, i) => i + BREAKOUT_MIN_ROOMS) as n (n)}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>
      <label class="form-control">
        <span class="label-text text-sm">{m.groups_call_breakout_duration()}</span>
        <input
          type="number"
          min="1"
          max="600"
          class="input-bordered input input-sm"
          placeholder={m.groups_call_breakout_duration_none()}
          bind:value={durationMinutes}
          data-testid="breakout-duration"
        />
      </label>
    </div>

    <div class="mt-3 flex gap-4 text-sm">
      <label class="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          class="radio radio-sm"
          name="breakout-mode"
          value="random"
          bind:group={mode}
          data-testid="breakout-mode-random"
        />
        {m.groups_call_breakout_assign_random()}
      </label>
      <label class="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          class="radio radio-sm"
          name="breakout-mode"
          value="manual"
          bind:group={mode}
          data-testid="breakout-mode-manual"
        />
        {m.groups_call_breakout_assign_manual()}
      </label>
    </div>

    <label class="mt-3 flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        class="checkbox checkbox-sm"
        checked={autoAssign}
        onchange={(e) =>
          chooseAutoAssign(/** @type {HTMLInputElement} */ (e.currentTarget).checked)}
        data-testid="breakout-auto-assign"
      />
      <span class="flex flex-col">
        <span>{m.groups_call_breakout_auto_assign()}</span>
        <span class="text-xs text-base-content/60">{m.groups_call_breakout_auto_assign_hint()}</span
        >
      </span>
    </label>

    <ul class="mt-3 min-h-0 flex-1 divide-y divide-base-200 overflow-y-auto text-sm">
      {#if assignable.length === 0}
        <li class="py-2 text-base-content/60">{m.groups_call_breakout_nobody()}</li>
      {/if}
      {#each assignable as row (row.key)}
        <li class="flex items-center gap-2 py-1.5" data-testid="breakout-seat">
          <span class="min-w-0 flex-1 truncate">{nameOf(row)}</span>
          {#if mode === 'manual'}
            <select
              class="select-bordered select select-xs"
              value={manual[row.key] ?? 0}
              onchange={(e) =>
                pick(row, Number(/** @type {HTMLSelectElement} */ (e.currentTarget).value))}
              aria-label={m.groups_call_breakout_move_to()}
              data-testid="breakout-seat-room"
            >
              <option value={0}>{m.groups_call_breakout_main_room()}</option>
              {#each roomNumbers as n (n)}
                <option value={n}>{m.groups_call_breakout_room_label({ n })}</option>
              {/each}
            </select>
          {/if}
        </li>
      {/each}
      {#each guests as row (row.key)}
        <li
          class="flex items-center gap-2 py-1.5 text-base-content/40"
          aria-disabled="true"
          data-testid="breakout-seat-guest"
        >
          <span class="min-w-0 flex-1 truncate">{nameOf(row)}</span>
          <span class="badge badge-ghost badge-sm">{m.groups_call_guest_badge()}</span>
        </li>
      {/each}
    </ul>
    {#if guests.length > 0}
      <p class="mt-2 text-xs text-base-content/60">{m.groups_call_breakout_guest_stays()}</p>
    {/if}
    <p class="mt-2 text-xs text-base-content/60">{m.groups_call_breakout_host_note()}</p>

    {#if error}
      <div class="mt-3 alert text-sm alert-error" role="alert" data-testid="breakout-error">
        {error}
      </div>
    {/if}

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={onClose} disabled={busy}>{m.common_cancel()}</button>
      <button
        class="btn btn-primary"
        onclick={start}
        disabled={busy || assignable.length === 0}
        data-testid="breakout-start"
      >
        {#if busy}
          <span class="loading loading-sm loading-spinner"></span>
          {m.groups_call_breakout_starting()}
        {:else}
          {m.groups_call_breakout_start()}
        {/if}
      </button>
    </div>
  </div>
</div>
