<!--
  ChannelCallRoster — drawn under an AV channel's row in a channel list:
  who is in its call right now and a one-click Join. The roster is the
  relay-signed kind 39004 (the relay knows who is in the LiveKit room),
  so it works without being in the call. Renders nothing while the call
  is empty.

  A sibling of the row, never inside it: the row is itself a link/button.
-->
<script>
  import { useCallPresence } from '$lib/groups/call-presence.svelte.js';
  import {
    getGroupCallState,
    joinGroupCall,
    showCallStage
  } from '$lib/groups/group-call.svelte.js';
  import { getCallPopoutState } from '$lib/groups/call-popout.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import CallCountPill from './CallCountPill.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pointer: {id: string, relay: string},
   *   name: string,
   *   onOpen: () => void | Promise<void>
   * }}
   */
  let { pointer, name, onOpen } = $props();

  const MAX_AVATARS = 3;
  const getPresence = useCallPresence(() => pointer);
  const participants = $derived(getPresence().participants);
  const shown = $derived(participants.slice(0, MAX_AVATARS));
  const overflow = $derived(Math.max(0, participants.length - MAX_AVATARS));

  const call = getGroupCallState();
  const inThisCall = $derived(call.isActiveFor(pointer) && call.phase !== 'idle');
  // The user is looking at this call right now: a stage view is mounted, not
  // stepped behind the chat, and the call is not in its own window. Then a
  // "back to the call" button would point at the screen they are on
  // (laoc, 2026-10-02) — the row only says where they are.
  const popout = getCallPopoutState();
  const stageOnScreen = $derived(
    inThisCall && call.stageViews > 0 && !call.stageHidden && !popout.open
  );
  const getActiveUser = useActiveUser();
  let busy = $state(false);

  async function join() {
    if (busy) return;
    busy = true;
    try {
      if (inThisCall) {
        showCallStage();
        await onOpen();
        return;
      }
      const user = getActiveUser();
      if (!user?.signer) return;
      await onOpen();
      await joinGroupCall(pointer, user, {
        title: name,
        href: `${window.location.pathname}${window.location.search}`
      });
    } finally {
      busy = false;
    }
  }
</script>

{#if participants.length > 0}
  <div
    class="flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-2 pb-1 pl-12"
    data-testid="channel-call-roster"
    title={m.groups_call_people_in_call({ count: participants.length })}
  >
    <CallCountPill count={participants.length} />
    <div class="flex min-w-0 flex-1 items-center -space-x-1.5">
      {#each shown as pubkey (pubkey)}
        <span class="rounded-full ring-2 ring-base-200">
          <ProfileAvatar {pubkey} size="2xs" showHoverCard={false} linkToProfile={false} />
        </span>
      {/each}
      {#if overflow > 0}
        <span class="pl-2.5 text-xs text-base-content/60">+{overflow}</span>
      {/if}
    </div>
    {#if stageOnScreen}
      <span
        class="ml-auto shrink-0 text-xs font-medium text-primary"
        data-testid="channel-call-roster-here"
      >
        {m.groups_call_in_this_call({ count: participants.length })}
      </span>
    {:else if getActiveUser()?.signer}
      {@const label = inThisCall
        ? m.groups_call_return()
        : m.groups_call_join_running({ count: participants.length })}
      <button
        type="button"
        class="btn ml-auto shrink-0 text-primary btn-ghost btn-sm"
        disabled={busy}
        aria-label={label}
        title={label}
        onclick={join}
      >
        {inThisCall ? m.groups_call_return() : m.groups_join()}
      </button>
    {/if}
  </div>
{/if}
