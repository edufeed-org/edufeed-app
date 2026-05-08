<!--
  HighlightItem — Single highlight with yellow left border.
  Optionally expandable to show a comment thread (NIP-22 kind 1111).
-->
<script>
  import {
    getHighlightText,
    getHighlightContext,
    getHighlightComment
  } from 'applesauce-common/helpers';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import EventDeleteButton from '$lib/components/shared/EventDeleteButton.svelte';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';

  /**
   * @type {{
   *   event: any,
   *   authorProfile?: any,
   *   onclick?: () => void,
   *   expanded?: boolean,
   *   activeUser?: any,
   *   communityPubkey?: string
   * }}
   */
  let {
    event,
    authorProfile = null,
    onclick = undefined,
    expanded = false,
    activeUser = undefined,
    communityPubkey = undefined
  } = $props();

  const text = $derived(getHighlightText(event));
  const context = $derived(getHighlightContext(event));
  const comment = $derived(getHighlightComment(event));
  const name = $derived(authorProfile ? getDisplayName(authorProfile) : 'Unknown');
  const timestamp = $derived(event?.created_at ? formatRelativeTime(event.created_at) : '');
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="rounded-r-lg border-l-4 border-warning bg-warning/5 p-3{onclick ? ' cursor-pointer' : ''}"
  {onclick}
>
  {#if text}
    <blockquote class="text-sm text-base-content/90 italic">&ldquo;{text}&rdquo;</blockquote>
  {/if}
  {#if comment}
    <p class="mt-1 text-sm text-base-content/80">{comment}</p>
  {/if}
  {#if context && !expanded}
    <p class="mt-1 line-clamp-2 text-xs text-base-content/50">{context}</p>
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
  </div>
</div>

{#if expanded && event}
  <div class="mt-2 border-t border-base-300 py-2" data-testid="reaction-bar">
    <ReactionBar {event} />
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="mt-2" data-testid="comment-list" onclick={(e) => e.stopPropagation()}>
    <CommentList rootEvent={event} {activeUser} {communityPubkey} />
  </div>
{/if}
