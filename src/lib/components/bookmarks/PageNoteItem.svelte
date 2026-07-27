<!--
  PageNoteItem — Single page note with blue left border
-->
<script>
  import { getDisplayName } from 'applesauce-core/helpers';
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import EventDeleteButton from '$lib/components/shared/EventDeleteButton.svelte';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';

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
      linkToProfile
      fallbackType="robohash"
    />
    <a
      href={resolve(profileLink(event.pubkey))}
      class="text-xs text-base-content/60 hover:underline"
    >
      {name}
    </a>
    {#if timestamp}
      <span class="text-xs text-base-content/40">· {timestamp}</span>
    {/if}
    <EventDeleteButton {event} {activeUser} />
  </div>
</div>

{#if expanded && event}
  <div class="mt-2 border-t border-base-300 py-2" data-testid="reaction-bar">
    <ReactionBar {event} />
  </div>
  <div class="mt-2" data-testid="comment-list">
    <CommentList rootEvent={event} {activeUser} {communityPubkey} />
  </div>
{/if}
