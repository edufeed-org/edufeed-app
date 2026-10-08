<!--
  CallHostActions — the host's entries in a participant row's menu
  (CallParticipantsPanel `menuExtras`): mute, stop camera, stop screen
  share, remove from the call, and — host only, on a member seat — make /
  revoke co-host. Renders nothing for a viewer without a role, for the
  viewer's own row, and never offers a role to a guest or a listener (the
  relay refuses those anyway: groups/call_host.go). The actions themselves
  are the stage's (`onAction`): it confirms a removal, calls the relay and
  toasts the outcome.
-->
<script>
  import {
    MicOffIcon,
    VideoIcon,
    ScreenShareIcon,
    CloseIcon,
    StarIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   row: import('$lib/groups/call-participants.js').ParticipantRow,
   *   myRole: import('$lib/groups/livekit.js').CallRole | null,
   *   onAction: (action: import('$lib/groups/livekit.js').CallModerationAction) => void
   * }}
   */
  let { row, myRole, onAction } = $props();

  const show = $derived(!!myRole && !row.isLocal);
  // A co-host moderates everyone but the host; roles are the host's alone.
  const canModerate = $derived(show && (myRole === 'host' || row.role !== 'host'));
  const canSetRole = $derived(
    show && myRole === 'host' && !row.guest && !row.listenOnly && row.role !== 'host'
  );
</script>

{#if canModerate || canSetRole}
  <li class="menu-title text-xs" data-testid="call-host-actions">
    {m.groups_call_host_actions_title()}
  </li>
  {#if canModerate}
    <li>
      <button
        class="text-sm"
        disabled={row.micOff}
        data-testid="call-mod-mute"
        onclick={() => onAction('mute')}
      >
        <MicOffIcon class_="h-4 w-4" title="" />
        {m.groups_call_mod_mute()}
      </button>
    </li>
    <li>
      <button
        class="text-sm"
        data-testid="call-mod-stop-video"
        onclick={() => onAction('stop-video')}
      >
        <VideoIcon class_="h-4 w-4" title="" />
        {m.groups_call_mod_stop_video()}
      </button>
    </li>
    <li>
      <button
        class="text-sm"
        data-testid="call-mod-stop-screen"
        onclick={() => onAction('stop-screen')}
      >
        <ScreenShareIcon class_="h-4 w-4" title="" />
        {m.groups_call_mod_stop_screen()}
      </button>
    </li>
  {/if}
  {#if canSetRole}
    <li>
      <button
        class="text-sm"
        data-testid={row.role === 'cohost' ? 'call-mod-revoke-cohost' : 'call-mod-make-cohost'}
        onclick={() => onAction(row.role === 'cohost' ? 'revoke-cohost' : 'make-cohost')}
      >
        <StarIcon class_="h-4 w-4" title="" />
        {row.role === 'cohost'
          ? m.groups_call_mod_revoke_cohost()
          : m.groups_call_mod_make_cohost()}
      </button>
    </li>
  {/if}
  {#if canModerate}
    <li>
      <button
        class="text-sm text-error"
        data-testid="call-mod-remove"
        onclick={() => onAction('remove')}
      >
        <CloseIcon class_="h-4 w-4" title="" />
        {m.groups_call_mod_remove()}
      </button>
    </li>
  {/if}
{/if}
