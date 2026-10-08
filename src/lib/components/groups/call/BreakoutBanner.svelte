<!--
  BreakoutBanner — "Breakout-Session läuft": what a seat in the MAIN room
  sees while a session runs that it is not part of (joined late with
  auto-assign off, declined its assignment, came back early). Lists the
  rooms with "Beitreten" — a request to the host seat, which seats the
  person and sends them over (groups/breakout.svelte.js requestBreakoutRoom)
  — and the deadline. Guests only read that they stay here: a call pass
  does not extend to a sub-channel. Pure view; the store owns the session.
-->
<script>
  import { ChannelsIcon } from '$lib/components/icons';
  import { formatCountdown } from '$lib/groups/breakout.js';
  import * as m from '$lib/paraglide/messages';

  /** @typedef {import('$lib/groups/breakout.svelte.js').BreakoutRoom} BreakoutRoom */
  /**
   * @type {{
   *   breakout: ReturnType<typeof import('$lib/groups/breakout.svelte.js').getBreakoutState>,
   *   guest: boolean,
   *   onJoin: (room: BreakoutRoom) => void
   * }}
   */
  let { breakout, guest, onJoin } = $props();

  const rooms = $derived(breakout.rooms);
  /** @param {string} roomId */
  const seated = (roomId) => breakout.membersByRoomId[roomId]?.size ?? 0;
</script>

<div
  class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-300 bg-base-200 px-3 py-2 text-sm"
  role="status"
  data-testid="breakout-banner"
>
  <ChannelsIcon class_="h-4 w-4 shrink-0" title="" />
  <span class="font-medium">{m.groups_call_breakout_banner_title()}</span>
  {#if breakout.remaining !== null}
    <span class="badge badge-sm tabular-nums badge-warning" data-testid="breakout-banner-deadline">
      {m.groups_call_breakout_time_left({ time: formatCountdown(breakout.remaining) })}
    </span>
  {/if}
  {#if guest}
    <span class="text-base-content/70" data-testid="breakout-banner-guest">
      {m.groups_call_breakout_banner_guest()}
    </span>
  {:else}
    <span class="text-base-content/70">{m.groups_call_breakout_banner_body()}</span>
    <ul class="flex flex-wrap gap-1">
      {#each rooms as room (room.id)}
        <li>
          <button
            type="button"
            class="btn gap-1 btn-outline btn-sm"
            disabled={breakout.joinRequest !== null}
            onclick={() => onJoin(room)}
            data-testid="breakout-banner-join"
          >
            {#if breakout.joinRequest?.roomId === room.id}
              <span class="loading loading-xs loading-spinner"></span>
              {m.groups_call_breakout_join_requested()}
            {:else}
              {m.groups_call_breakout_room_label({ n: room.index })}
              <span class="text-base-content/60">({seated(room.id)})</span>
              · {m.groups_call_breakout_join()}
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
