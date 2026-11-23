<!--
  ChannelCallStart — a small call button beside an AV channel's row in a
  channel list (issue wcmfm3hh): open the channel and start its call in one
  click, or join it when it is already running. Holds no presence
  subscription: starting and joining are the same request.

  A sibling of the row inside a `group/ch relative` wrapper, never inside the
  row (the row is itself a link/button). Shown on hover and keyboard focus.
-->
<script>
  import { joinGroupCallWithConfirm } from '$lib/groups/group-call.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { VideoIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pointer: {id: string, relay: string},
   *   name: string,
   *   onOpen: () => void | Promise<void>,
   *   class_?: string
   * }}
   */
  // class_: where the button sits in its row wrapper (the rails differ).
  let { pointer, name, onOpen, class_ = 'right-1.5' } = $props();

  const getActiveUser = useActiveUser();
  let busy = $state(false);

  async function start() {
    const user = getActiveUser();
    if (busy || !user?.signer) return;
    busy = true;
    try {
      await onOpen();
      await joinGroupCallWithConfirm(pointer, user, {
        title: name,
        href: `${window.location.pathname}${window.location.search}`
      });
    } finally {
      busy = false;
    }
  }
</script>

{#if getActiveUser()?.signer}
  <button
    type="button"
    class="btn pointer-events-none absolute top-1/2 btn-square -translate-y-1/2 bg-base-200 opacity-0 btn-ghost transition-opacity btn-xs group-hover/ch:pointer-events-auto group-hover/ch:opacity-100 focus:pointer-events-auto focus:opacity-100 {class_}"
    data-testid="channel-call-start"
    disabled={busy}
    title={m.groups_call_start()}
    aria-label={m.groups_call_start_in({ name })}
    onclick={start}
  >
    <VideoIcon class_="h-4 w-4" />
  </button>
{/if}
