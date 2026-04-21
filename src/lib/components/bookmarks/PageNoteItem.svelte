<!--
  PageNoteItem — Single page note with blue left border
-->
<script>
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import { ChatIcon } from '$lib/components/icons';
  import EventDeleteButton from '$lib/components/shared/EventDeleteButton.svelte';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
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
  const timestamp = $derived(event?.created_at ? formatRelativeTime(event.created_at) : '');
</script>

<div class="rounded-r-lg border-l-4 border-info bg-info/5 p-3">
  {#if event.content}
    <p class="text-sm text-base-content/90">{event.content}</p>
  {/if}
  <div class="mt-2 flex items-center gap-2">
    <ProfileAvatar
      pubkey={event.pubkey}
      profile={authorProfile}
      size="2xs"
      fallbackType="robohash"
    />
    <span class="text-xs text-base-content/60">{name}</span>
    {#if timestamp}
      <span class="text-xs text-base-content/40">· {timestamp}</span>
    {/if}
    <EventDeleteButton {event} {activeUser} />
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
