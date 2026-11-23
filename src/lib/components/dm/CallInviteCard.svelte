<!--
  CallInviteCard — a call link in a direct message (quick-call.js) as a card:
  whether the call is still on, how many people are in it, and a button that
  keeps the link exactly as sent (the pass code sits in its fragment). The
  relay's public pass check answers both questions in one request.
-->
<script>
  import { checkCallPass } from '$lib/groups/call-passes.js';
  import { QUICK_CALL_TTL_S, rememberCallOrigin } from '$lib/groups/quick-call.js';
  import { getGroupCallState } from '$lib/groups/group-call.svelte.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { VideoIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  const RECHECK_MS = 20_000;

  /**
   * @type {{
   *   invite: {url: string, pointer: {id: string, relay: string}, code: string},
   *   sentAt: number,
   *   peer?: string
   * }}
   */
  // peer: the other person of the conversation, for the way back after the call
  let { invite, sentAt, peer } = $props();

  /** @type {'checking' | 'open' | 'ended' | 'unknown'} */
  let status = $state('checking');
  let liveCount = $state(0);

  // This tab already sits in that call: the button is the way back to it.
  const call = getGroupCallState();
  const inThisCall = $derived(
    call.activeKey === channelKey(invite.pointer) &&
      (call.phase === 'ready' || call.phase === 'requesting')
  );

  $effect(() => {
    const { pointer, code } = invite;
    // A link older than its pass cannot work any more: no request for the
    // old invitations of a long thread.
    if (Date.now() / 1000 - sentAt > QUICK_CALL_TTL_S) {
      status = 'ended';
      return;
    }
    let alive = true;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const look = async () => {
      const pass = await checkCallPass(pointer.relay, pointer.id, code);
      if (!alive) return;
      liveCount = pass.liveCount;
      if (pass.valid) status = 'open';
      else if (pass.reason === 'unreachable' || pass.reason === 'not_yet') status = 'unknown';
      else status = 'ended';
      // an ended call does not come back
      if (status !== 'ended') timer = setTimeout(look, RECHECK_MS);
    };
    look();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  });
</script>

<div class="flex flex-col gap-2" data-testid="dm-call-invite">
  <div class="flex items-center gap-2">
    <VideoIcon class_="h-5 w-5 shrink-0" title="" />
    <div class="min-w-0">
      <div class="font-medium">{m.dm_call_card_label()}</div>
      <div class="text-xs opacity-70" data-testid="dm-call-invite-status">
        {#if status === 'ended'}
          {m.dm_call_card_ended()}
        {:else if status === 'open' && liveCount > 0}
          {m.dm_call_card_running({ count: liveCount })}
        {:else if status === 'open'}
          {m.dm_call_card_waiting()}
        {/if}
      </div>
    </div>
  </div>
  {#if status !== 'ended'}
    <a
      href={invite.url}
      class="btn self-start btn-sm"
      data-testid="dm-call-invite-join"
      onclick={() => peer && rememberCallOrigin(invite.pointer, peer)}
    >
      {inThisCall ? m.groups_call_return() : m.call_landing_join()}
    </a>
  {/if}
</div>
