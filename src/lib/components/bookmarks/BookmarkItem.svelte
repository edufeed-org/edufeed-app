<!--
  BookmarkItem — Single bookmark with content annotation and optional comment thread.
  Uses green/primary left border to distinguish from highlights (yellow) and page notes (blue).
-->
<script>
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { updateBookmarkContent } from '$lib/helpers/bookmark.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import { ChatIcon, EditIcon } from '$lib/components/icons';
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
  let isEditing = $state(false);
  let editContent = $state('');
  let isSaving = $state(false);

  const isOwner = $derived(Boolean(activeUser?.pubkey) && event?.pubkey === activeUser?.pubkey);
  const name = $derived(authorProfile ? getDisplayName(authorProfile) : 'Unknown');
  const timestamp = $derived(event?.created_at ? formatRelativeTime(event.created_at) : '');

  function startEditing() {
    editContent = event.content || '';
    isEditing = true;
  }

  function cancelEditing() {
    isEditing = false;
    editContent = '';
  }

  async function saveEdit() {
    if (!activeUser || isSaving) return;
    isSaving = true;
    try {
      const signed = await updateBookmarkContent(event, editContent, activeUser);
      publishEventOptimistic(signed);
      isEditing = false;
    } catch (err) {
      console.error('Failed to update bookmark:', err);
    } finally {
      isSaving = false;
    }
  }
</script>

<div class="rounded-r-lg border-l-4 border-primary bg-primary/5 p-3">
  {#if isEditing}
    <textarea class="textarea-bordered textarea w-full text-sm" rows="3" bind:value={editContent}
    ></textarea>
    <div class="mt-2 flex gap-2">
      <button class="btn btn-xs btn-primary" onclick={saveEdit} disabled={isSaving}>
        {#if isSaving}
          <span class="loading loading-xs loading-spinner"></span>
        {/if}
        {m.common_save()}
      </button>
      <button class="btn btn-ghost btn-xs" onclick={cancelEditing} disabled={isSaving}>
        {m.common_cancel()}
      </button>
    </div>
  {:else if event.content}
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
    {#if isOwner && !isEditing}
      <button class="btn gap-1 text-base-content/50 btn-ghost btn-xs" onclick={startEditing}>
        <EditIcon class_="w-3.5 h-3.5" />
        {m.common_edit()}
      </button>
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
