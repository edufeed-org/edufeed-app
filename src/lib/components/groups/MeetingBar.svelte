<!--
  MeetingBar — one line above a NIP-29 channel's timeline naming the next
  meeting that runs, opens or starts within 24 h:
  "<title> · heute 14:00 · Beitreten". Hidden when there is none. The pick
  (nextBarMeeting) is re-evaluated every 30 s, so the bar appears and its
  join button turns on without a reload.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { CalendarIcon } from '$lib/components/icons';
  import { formatTimestamp, formatTimeOfDay } from '$lib/helpers/dates.js';
  import {
    nextBarMeeting,
    canJoinMeetingNow,
    meetingTitle,
    nextMeetingBoundary
  } from '$lib/groups/meetings.js';

  /**
   * @typedef {object} Props
   * @property {any[]} meetings - this channel's meetings (kind 31923, group-filtered)
   * @property {(() => void) | undefined} [onJoin] - the channel's call join; absent = cannot join
   * @property {boolean} [callRunning] - the channel's call has participants right now
   */
  /** @type {Props} */
  let { meetings, onJoin = undefined, callRunning = false } = $props();

  let nowS = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const timer = setInterval(() => {
      nowS = Math.floor(Date.now() / 1000);
    }, 30_000);
    return () => clearInterval(timer);
  });
  // The 30 s clock plus an exact timer at the next phase boundary (QA round 3
  // K3): re-armed whenever `nowS` moves. Capped at setTimeout's 32-bit limit.
  $effect(() => {
    const boundary = nextMeetingBoundary(meetings, nowS);
    if (boundary === null) return;
    const delayMs = Math.min((boundary - nowS) * 1000 + 50, 2 ** 31 - 1);
    const timer = setTimeout(() => {
      nowS = Math.floor(Date.now() / 1000);
    }, delayMs);
    return () => clearTimeout(timer);
  });

  const next = $derived(nextBarMeeting(meetings, nowS));
  const title = $derived((next && meetingTitle(next.event)) || m.meeting_card_label());

  /** Local calendar day as a comparable key. @param {number} s */
  const dayKey = (s) => {
    const d = new Date(s * 1000);
    return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
  };
  const whenLabel = $derived.by(() => {
    if (!next) return '';
    const time = formatTimeOfDay(next.start);
    // While it runs / in the join window the start day is no news (K4).
    if (next.phase === 'running')
      return m.meeting_bar_running_since({
        time:
          dayKey(next.start) === dayKey(nowS)
            ? time
            : `${formatTimestamp(next.start, { day: '2-digit', month: '2-digit' })} ${time}`
      });
    if (next.phase === 'joinable') return m.meeting_bar_starting_soon({ time });
    const today = new Date(nowS * 1000);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (dayKey(next.start) === dayKey(nowS)) return m.meeting_bar_today({ time });
    if (dayKey(next.start) === dayKey(Math.floor(tomorrow.getTime() / 1000)))
      return m.meeting_bar_tomorrow({ time });
    return `${formatTimestamp(next.start, { day: '2-digit', month: '2-digit' })} ${time}`;
  });
  // Same rule as the card (canJoinMeetingNow).
  const joinEnabled = $derived(!!next && canJoinMeetingNow(next.phase, callRunning));
</script>

{#if next}
  <div
    class="flex items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-4 py-2 text-sm"
    role="status"
    aria-label={m.meeting_bar_label()}
    data-testid="meeting-bar"
  >
    <span class="flex min-w-0 items-center gap-2">
      <CalendarIcon class_="w-4 h-4 shrink-0 text-primary" />
      <span class="truncate"
        ><span class="font-semibold">{title}</span>
        <span class="text-base-content/70">· {whenLabel}</span></span
      >
    </span>
    {#if onJoin}
      <button
        type="button"
        class="btn shrink-0 btn-sm btn-primary"
        data-testid="meeting-bar-join"
        disabled={!joinEnabled}
        title={joinEnabled ? m.meeting_card_join() : m.meeting_card_join_hint()}
        onclick={() => onJoin?.()}
      >
        {m.meeting_card_join()}
      </button>
    {/if}
  </div>
{/if}
