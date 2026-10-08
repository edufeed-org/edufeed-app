<!--
  MeetingCard — a scheduled meeting (NIP-52 kind 31923 with one group-id `h`
  tag) inside a NIP-29 channel's timeline, below the chat bubble's header.

  The phase (upcoming / joinable / running / past) is re-evaluated every 30 s.
  "Beitreten" is the channel's own call join (`onJoin`, from GroupChat) —
  active from 15 minutes before the start, and after the end only while the
  channel's call still runs (canJoinMeetingNow, shared with the bar). The
  organiser gets "Gast-Link kopieren": the link is rebuilt from the meeting's
  pass (self-encrypted code, listed by GroupChat), so it works on any of the
  organiser's devices. "Bearbeiten" (author only) hands the meeting and its
  pass to the opener (`onEdit`, GroupChat), which reopens the schedule dialog
  in edit mode — the card itself never publishes. Deleting revokes the
  meeting's passes first (meeting-actions.js) and is open to the author and
  channel moderators.
-->
<script>
  import { TimelineModel } from 'applesauce-core/models';
  import * as m from '$lib/paraglide/messages';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { CalendarIcon } from '$lib/components/icons';
  import { showToast } from '$lib/helpers/toast';
  import { formatTimestamp, formatTimeOfDay } from '$lib/helpers/dates.js';
  import { hasNip44 } from '$lib/helpers/nip44.js';
  import { unique } from '$lib/helpers/unique.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import {
    meetingTimes,
    meetingPhase,
    meetingCoordinate,
    meetingTitle,
    canJoinMeetingNow,
    nextMeetingBoundary,
    findMeetingPass,
    buildMeetingIcs,
    icsFileName
  } from '$lib/groups/meetings.js';
  import { CALL_PASS_KIND, passLinkFor } from '$lib/groups/call-passes.js';
  import { deleteMeeting } from '$lib/groups/meeting-actions.js';

  /**
   * @typedef {object} Props
   * @property {any} event - the meeting (kind 31923)
   * @property {{id: string, relay: string}} pointer - the channel
   * @property {{pubkey: string, signer: any} | null | undefined} user - active account
   * @property {boolean} isAdmin - channel moderator (may delete any meeting)
   * @property {(() => void) | undefined} [onJoin] - the channel's call join; absent = cannot join
   * @property {((event: any, guestPass: any | null) => void) | undefined} [onEdit] - opens the
   *   edit dialog for the author's own meeting; absent = no editing here
   * @property {boolean} [callRunning] - the channel's call has participants right now
   */
  /** @type {Props} */
  let {
    event,
    pointer,
    user,
    isAdmin,
    onJoin = undefined,
    onEdit = undefined,
    callRunning = false
  } = $props();

  // Unique per card: several cards can sit in one timeline.
  const uid = $props.id();
  const TICK_MS = 30_000;
  let nowS = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const timer = setInterval(() => {
      nowS = Math.floor(Date.now() / 1000);
    }, TICK_MS);
    return () => clearInterval(timer);
  });
  // The 30 s clock plus an exact timer at the next phase boundary (QA round 3
  // K3): re-armed whenever `nowS` moves. Capped at setTimeout's 32-bit limit.
  $effect(() => {
    const boundary = nextMeetingBoundary([event], nowS);
    if (boundary === null) return;
    const delayMs = Math.min((boundary - nowS) * 1000 + 50, 2 ** 31 - 1);
    const timer = setTimeout(() => {
      nowS = Math.floor(Date.now() / 1000);
    }, delayMs);
    return () => clearTimeout(timer);
  });

  /** @param {string} name */
  const tagValue = (name) =>
    event.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1] ?? '';

  const title = $derived(meetingTitle(event) || m.meeting_card_label());
  const summary = $derived((event.content || tagValue('summary') || '').trim());
  const times = $derived(meetingTimes(event));
  const phase = $derived(times ? meetingPhase(times, nowS) : 'past');

  /** @param {number} s */
  const dateOf = (s) => formatTimestamp(s, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeLabel = $derived.by(() => {
    if (!times) return '';
    const { start, end } = times;
    return dateOf(start) === dateOf(end)
      ? `${dateOf(start)} ${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`
      : `${dateOf(start)} ${formatTimeOfDay(start)} – ${dateOf(end)} ${formatTimeOfDay(end)}`;
  });

  const statusLabel = $derived(
    {
      upcoming: m.meeting_status_upcoming(),
      joinable: m.meeting_status_joinable(),
      running: m.meeting_status_running(),
      past: m.meeting_status_past()
    }[phase]
  );
  const statusClass = $derived(
    phase === 'running'
      ? 'badge-primary'
      : phase === 'joinable'
        ? 'badge-accent'
        : phase === 'past'
          ? 'badge-ghost'
          : 'badge-outline'
  );

  // Invitees: tag-derived, so deduped before the keyed lists (CLAUDE.md).
  const invitedPubkeys = $derived(
    unique(
      (event.tags ?? [])
        .filter((/** @type {string[]} */ t) => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] ?? ''))
        .map((/** @type {string[]} */ t) => t[1])
    )
  );
  const invitedNames = $derived(
    unique(
      (event.tags ?? [])
        .filter((/** @type {string[]} */ t) => t[0] === 'participant')
        .map((/** @type {string[]} */ t) => (t[1] ?? '').trim())
        .filter(Boolean)
    )
  );
  const getProfiles = useProfileMap(() => invitedPubkeys);

  // Join: from 15 minutes before the start; after the end only while the
  // channel's call still runs (the call is the channel's, not the meeting's).
  const showJoin = $derived(!!onJoin && (phase !== 'past' || callRunning));
  const joinEnabled = $derived(canJoinMeetingNow(phase, callRunning));

  const isAuthor = $derived(!!user && user.pubkey === event.pubkey);
  const canDelete = $derived(!!user && (isAuthor || isAdmin));
  // Only the author can re-sign the addressable event (a moderator cannot).
  const canEdit = $derived(isAuthor && !!onEdit);

  // The organiser's guest link: the meeting's pass, read from the store.
  // GroupChat lists the channel's passes ONCE per visit (any of the
  // organiser's devices) and a pass minted a moment ago is added there by
  // the scheduler, so no card fetches on its own; a past meeting reads
  // nothing.
  const coordinate = $derived(meetingCoordinate(event));
  const canHaveLink = $derived(isAuthor && hasNip44(user?.signer));
  const linkActive = $derived(canHaveLink && phase !== 'past');
  /** @type {any[]} */
  let passes = $state.raw([]);
  $effect(() => {
    const coord = coordinate;
    if (!linkActive) return;
    const sub = eventStore
      .model(TimelineModel, { kinds: [CALL_PASS_KIND], '#a': [coord] })
      .subscribe((events) => {
        passes = events;
      });
    return () => sub.unsubscribe();
  });
  const guestPass = $derived.by(() => {
    if (!linkActive) return null;
    const live = passes.filter((pass) => {
      const exp = Number(
        pass.tags?.find((/** @type {string[]} */ t) => t[0] === 'expiration')?.[1]
      );
      return pass.pubkey === user?.pubkey && Number.isFinite(exp) && exp > nowS;
    });
    return findMeetingPass(live, coordinate);
  });

  async function copyGuestLink() {
    if (!guestPass || !user) return;
    const url = await passLinkFor(guestPass, user, pointer, window.location.origin);
    if (!url) {
      showToast(m.meeting_card_guest_link_failed(), 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(m.meeting_card_guest_link_copied(), 'success');
    } catch {
      showToast(m.meeting_card_guest_link_failed(), 'error');
    }
  }

  function downloadIcs() {
    if (!times) return;
    const ics = buildMeetingIcs({
      title,
      start: times.start,
      end: times.end,
      description: summary,
      url: tagValue('location'),
      uid: coordinate,
      // SEQUENCE/LAST-MODIFIED: an edit re-publishes the coordinate with a
      // newer created_at, so a calendar that already imported the meeting
      // replaces its entry instead of adding a second one.
      modifiedS: event.created_at
    });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = icsFileName(title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  let confirmDelete = $state(false);
  let deleting = $state(false);

  async function runDelete() {
    if (!user || deleting) return;
    deleting = true;
    try {
      const deletion = await deleteMeeting({
        relayConn: pool.relay(pointer.relay),
        event,
        user,
        asAdmin: isAdmin
      });
      // Kind 5 (author): the store's delete handling drops the meeting from
      // every TimelineModel. Kind 9005 (moderator): GroupChat's deletions
      // model hides it, as for any moderated message.
      eventStore.add(deletion);
      confirmDelete = false;
      showToast(m.meeting_card_deleted(), 'success');
    } catch (err) {
      console.error('meeting: delete failed', err);
      showToast(m.meeting_card_delete_failed(), 'error');
    }
    deleting = false;
  }
</script>

<!-- Attachment-card grammar (cf. PollMessage): paper surface with ink text
     so the card reads the same on a primary "own message" bubble. -->
<div
  data-testid="meeting-card"
  class="mt-2 w-full min-w-64 rounded-lg border border-base-300 bg-base-100 p-3 text-base-content"
>
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      <p class="flex cursor-default items-center gap-1 text-xs text-base-content/60 select-none">
        <CalendarIcon class_="w-3.5 h-3.5" />
        {m.meeting_card_label()}
      </p>
      <p class="font-semibold break-words" data-testid="meeting-card-title">{title}</p>
      <p class="text-sm" data-testid="meeting-card-time">{timeLabel}</p>
    </div>
    <span
      class="badge shrink-0 cursor-default badge-sm select-none {statusClass}"
      data-testid="meeting-card-status">{statusLabel}</span
    >
  </div>

  {#if summary}
    <p class="mt-2 text-sm break-words whitespace-pre-line">{summary}</p>
  {/if}

  {#if invitedPubkeys.length || invitedNames.length}
    <div class="mt-2 flex flex-wrap items-center gap-1 text-xs text-base-content/70">
      <span class="mr-1 cursor-default select-none">{m.meeting_card_participants()}</span>
      {#each invitedPubkeys as pubkey (pubkey)}
        <span title={getUserDisplayName(pubkey, getProfiles().get(pubkey))}>
          <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="xs" />
        </span>
      {/each}
      {#each invitedNames as name (name)}
        <span class="badge cursor-default badge-ghost badge-sm select-none">{name}</span>
      {/each}
    </div>
  {/if}

  <div class="mt-3 flex flex-wrap gap-2">
    {#if showJoin}
      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="meeting-card-join"
        disabled={!joinEnabled}
        title={joinEnabled ? m.meeting_card_join() : m.meeting_card_join_hint()}
        onclick={() => onJoin?.()}
      >
        {m.meeting_card_join()}
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      data-testid="meeting-card-ics"
      onclick={downloadIcs}
    >
      {m.meeting_card_ics()}
    </button>
    {#if guestPass}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="meeting-card-guest-link"
        onclick={copyGuestLink}
      >
        {m.meeting_card_copy_guest_link()}
      </button>
    {/if}
    {#if canEdit}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        data-testid="meeting-card-edit"
        onclick={() => onEdit?.(event, guestPass)}
      >
        {m.meeting_card_edit()}
      </button>
    {/if}
    {#if canDelete}
      <button
        type="button"
        class="btn text-error btn-ghost btn-sm"
        data-testid="meeting-card-delete"
        onclick={() => (confirmDelete = true)}
      >
        {m.meeting_card_delete()}
      </button>
    {/if}
  </div>
</div>

{#if confirmDelete}
  <div
    class="modal-open modal"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="{uid}-delete-title"
    data-testid="meeting-card-delete-dialog"
  >
    <div class="modal-box max-w-sm text-base-content">
      <h3 id="{uid}-delete-title" class="font-bold">{m.meeting_card_delete_confirm_title()}</h3>
      <p class="py-2 text-sm opacity-70">{m.meeting_card_delete_confirm_body()}</p>
      <p class="truncate rounded bg-base-200 px-2 py-1 text-xs">{title} · {timeLabel}</p>
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => (confirmDelete = false)}
          >{m.common_cancel()}</button
        >
        <button
          class="btn btn-error"
          data-testid="meeting-card-delete-confirm"
          disabled={deleting}
          onclick={runDelete}
        >
          {m.meeting_card_delete()}
        </button>
      </div>
    </div>
  </div>
{/if}
