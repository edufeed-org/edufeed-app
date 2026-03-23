<!--
  BookmarkItem — Single bookmark with content annotation and optional comment thread.
  Uses green/primary left border to distinguish from highlights (yellow) and page notes (blue).
-->
<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import { ChatIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   event: any,
   *   authorProfile?: any,
   *   expanded?: boolean,
   *   activeUser?: any,
   *   communityPubkey?: string
   * }}
   */
  let {
    event,
    authorProfile = null,
    expanded = false,
    activeUser = undefined,
    communityPubkey = undefined
  } = $props();

  let showComments = $state(false);

  const name = $derived(authorProfile ? getDisplayName(authorProfile) : 'Unknown');
  const avatar = $derived(authorProfile ? getProfilePicture(authorProfile) : null);
  const timestamp = $derived(event?.created_at ? formatRelativeTime(event.created_at) : '');
</script>

<div class="rounded-r-lg border-l-4 border-primary bg-primary/5 p-3">
  {#if event.content}
    <p class="text-sm text-base-content/90">{event.content}</p>
  {/if}
  <div class="mt-2 flex items-center gap-2">
    {#if avatar}
      <div class="avatar">
        <div class="w-4 rounded-full">
          <img src={avatar} alt={name} />
        </div>
      </div>
    {/if}
    <span class="text-xs text-base-content/60">{name}</span>
    {#if timestamp}
      <span class="text-xs text-base-content/40">· {timestamp}</span>
    {/if}
    {#if expanded}
      <button
        class="btn ml-auto gap-1 text-base-content/50 btn-ghost btn-xs"
        onclick={() => (showComments = !showComments)}
      >
        <ChatIcon class_="w-3.5 h-3.5" />
        {showComments ? m.comments_cancel() : m.comments_add()}
      </button>
    {/if}
  </div>
</div>

{#if expanded && showComments && event}
  <div class="mt-2">
    <CommentList rootEvent={event} {activeUser} {communityPubkey} />
  </div>
{/if}
