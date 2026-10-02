<!--
  CallDock — the running call while no call stage is on screen: the user
  switched channel, left the page, or stepped back to the chat. The call
  store owns the connection, so the call keeps going; this pill says which
  call it is and who is in it, and offers mute, "back to call" and leave.

  Mounted by the root layout through lazyComponent, only while a call is
  active and no call view is on screen (livekit-client stays out of every
  route's static graph). It is a strip IN the layout's flow, right under
  the navbar, not a floating pill: floating, it covered the "‹ Kanäle"
  breadcrumb at 390 px and the channel title / page heading at 768 and
  1440 px (QA 2026-10-02 B4/C2). In flow, the page below simply gets
  shorter, so it can never sit on top of a control.
-->
<script>
  import { goto } from '$app/navigation';
  import { getLiveKitState, toggleMute } from '$lib/services/livekit-connection.svelte.js';
  import {
    getGroupCallState,
    leaveGroupCall,
    showCallStage,
    callErrorMessage
  } from '$lib/groups/group-call.svelte.js';
  import { playLeaveSound } from '$lib/services/call-sounds.js';
  import { showToast } from '$lib/helpers/toast';
  import { callMediaErrorMessage } from '$lib/groups/call-media-errors.js';
  import { MeetIcon, MicIcon, MicOffIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  const lk = getLiveKitState();
  const call = getGroupCallState();

  const count = $derived((lk.localParticipant ? 1 : 0) + lk.remoteParticipants.length);
  const someoneSpeaking = $derived(lk.speakingParticipantIds.size > 0);

  async function onToggleMute() {
    try {
      await toggleMute();
    } catch (err) {
      console.warn('call mic action failed:', err);
      showToast(callMediaErrorMessage(err, 'mic'), 'error');
    }
  }

  async function backToCall() {
    showCallStage();
    if (call.href) await goto(call.href);
  }

  function leave() {
    playLeaveSound();
    leaveGroupCall();
  }
</script>

<!-- An ended call (the server removed us / the connection died) gets no
     live dock: the channel itself says what happened. -->
{#if call.phase !== 'ended'}
  <div
    class="relative z-20 flex shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 py-1 pr-2 pl-3 shadow-sm"
    role="region"
    aria-label={m.groups_call_in_call()}
    data-testid="call-dock"
  >
    <span class="relative flex h-2.5 w-2.5 shrink-0">
      {#if someoneSpeaking}
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75 motion-reduce:animate-none"
        ></span>
      {/if}
      <span
        class="relative inline-flex h-2.5 w-2.5 rounded-full {call.phase === 'error'
          ? 'bg-error'
          : 'bg-success'}"
      ></span>
    </span>
    <!-- Icon only from sm: at 390 px the title needs the room. -->
    <span class="hidden shrink-0 sm:inline-flex"
      ><MeetIcon class_="h-4 w-4 text-primary" title="" /></span
    >
    <div class="flex min-w-0 flex-1 flex-col leading-tight">
      <span class="truncate text-sm font-medium">{call.title || m.groups_call_in_call()}</span>
      <span class="truncate text-xs text-base-content/60">
        {#if call.phase === 'error'}
          <span class="text-error">{callErrorMessage(call.error)}</span>
        {:else if lk.connectionState === 'reconnecting'}
          {m.groups_call_reconnecting()}
        {:else if !lk.isConnected}
          {m.groups_call_connecting()}
        {:else}
          {m.groups_call_people_in_call({ count })}
        {/if}
      </span>
    </div>
    {#if lk.isConnected && lk.canPublish}
      <button
        class="btn btn-circle btn-sm {lk.isMuted ? 'btn-error' : 'btn-ghost'}"
        aria-label={lk.isMuted ? m.groups_call_unmute() : m.groups_call_mute()}
        title={lk.isMuted ? m.groups_call_unmute() : m.groups_call_mute()}
        onclick={onToggleMute}
      >
        {#if lk.isMuted}
          <MicOffIcon class_="h-4 w-4" title="" />
        {:else}
          <MicIcon class_="h-4 w-4" title="" />
        {/if}
      </button>
    {/if}
    <button class="btn btn-sm btn-primary" onclick={backToCall}>{m.groups_call_return()}</button>
    <button class="btn btn-sm btn-error" onclick={leave}>{m.groups_call_leave()}</button>
  </div>
{/if}
