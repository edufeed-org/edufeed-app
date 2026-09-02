<!--
  ChatMessageRow — a single chat message (DaisyUI `.chat` bubble).

  Extracted from the public community chat (Chat.svelte) so the same
  avatar/header/bubble/reply-preview/footer markup can be reused by
  ChannelChat.svelte (concord private channels), which previously hand-rolled
  a visually inferior version of the same row. Data fetching, publish paths,
  and reaction machinery stay with each caller — this component is purely
  presentational; callers resolve `displayName`/`profile`/`replyPreview`
  themselves and hand reaction rendering through the `reactions` snippet.
-->
<script>
  import { resolve } from '$app/paths';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import LinkPreviewList from '$lib/components/shared/LinkPreviewList.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { LinkIcon, ReplyIcon } from '$lib/components/icons';
  import { profileLink } from '$lib/helpers/nostrUtils.js';

  /**
   * @typedef {Object} Props
   * @property {any} message - Nostr event/rumor: {id, pubkey, content, created_at, tags}
   * @property {boolean} isOwnMessage
   * @property {string} displayName - resolved display name for message.pubkey
   * @property {string} timestamp - pre-formatted timestamp string (formatMessageTimestamp)
   * @property {any} [profile] - profile object for the avatar (already resolved by caller)
   * @property {boolean} [linkProfile] - link avatar + name to the profile page (default true)
   * @property {{ displayName: string, content: string } | null} [replyPreview] - resolved reply-parent preview, or null
   * @property {((message: any) => void) | null} [onReply] - shows a hover-reveal reply button in the header when provided
   * @property {string} [replyTitle] - title attribute for the reply button (default "Reply", override for i18n)
   * @property {((message: any) => void) | null} [onCopyLink] - shows a hover-reveal copy-link button in the header when provided (message deep links)
   * @property {string} [copyLinkTitle] - title attribute for the copy-link button (default "Copy link", override for i18n)
   * @property {boolean} [showLinkPreviews] - render LinkPreviewList below the message content (default false)
   * @property {number} [replyCount] - shows an "N replies" affordance in the footer when > 0 and `onOpenThread` is set
   * @property {string} [replyCountLabel] - pre-formatted label for that affordance (caller owns pluralisation/i18n)
   * @property {((message: any) => void) | null} [onOpenThread] - opens the thread for this message
   * @property {import('svelte').Snippet<[any]>} [reactions] - rendered inside chat-footer, receives `message`
   * @property {import('svelte').Snippet<[any]>} [attachments] - rendered inside the bubble below the content, receives `message` (e.g. concord imeta media)
   */

  /** @type {Props} */
  let {
    message,
    isOwnMessage,
    displayName,
    timestamp,
    profile = undefined,
    linkProfile = true,
    replyPreview = null,
    onReply = null,
    replyTitle = 'Reply',
    onCopyLink = null,
    copyLinkTitle = 'Copy link',
    showLinkPreviews = false,
    replyCount = 0,
    replyCountLabel = '',
    onOpenThread = null,
    reactions = undefined,
    attachments = undefined
  } = $props();

  // The footer exists for reactions today; the thread affordance shares it so a
  // message with replies but no reactions still gets one.
  const showThreadLink = $derived(replyCount > 0 && !!onOpenThread);
</script>

<!-- data-message-id: DOM anchor for message deep links (?message= — see
     helpers/message-anchor.js), on every row of both chat engines. -->
<div class="group chat {isOwnMessage ? 'chat-end' : 'chat-start'}" data-message-id={message.id}>
  {#if !isOwnMessage}
    <ProfileAvatar
      pubkey={message.pubkey}
      {profile}
      size="sm"
      linkToProfile={linkProfile}
      class="chat-image"
    />
  {/if}

  <div class="chat-header mb-1 flex items-center gap-1 text-xs opacity-70">
    {#if !isOwnMessage}
      {#if linkProfile}
        <a href={resolve(profileLink(message.pubkey))} class="font-semibold hover:underline"
          >{displayName}</a
        >
      {:else}
        <span class="font-semibold">{displayName}</span>
      {/if}
      <span>&middot;</span>
    {/if}
    <time datetime={new Date(message.created_at * 1000).toISOString()}>
      {timestamp}
    </time>
    {#if onReply}
      <button
        type="button"
        onclick={() => onReply(message)}
        class="ml-1 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
        title={replyTitle}
      >
        <ReplyIcon class="h-3.5 w-3.5" />
      </button>
    {/if}
    {#if onCopyLink}
      <button
        type="button"
        onclick={() => onCopyLink(message)}
        class="ml-1 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
        title={copyLinkTitle}
        data-testid="message-copy-link"
      >
        <LinkIcon class_="h-3.5 w-3.5" />
      </button>
    {/if}
  </div>

  <div class="chat-bubble {isOwnMessage ? 'chat-bubble-primary' : ''}">
    <!-- Reply quote preview -->
    {#if replyPreview}
      <div
        class="mb-1 rounded border-l-2 border-primary/40 bg-base-300/50 px-2 py-1 text-xs text-base-content/70"
      >
        <span class="font-semibold">{replyPreview.displayName}</span>
        <p class="truncate">{replyPreview.content}</p>
      </div>
    {/if}
    <!-- Chat is the only surface that opts into restricted markdown; the
         other seven NostrContentRenderer callers keep the plain walk. -->
    <NostrContentRenderer event={message} markdown />
    {#if attachments}
      {@render attachments(message)}
    {/if}
    {#if showLinkPreviews}
      <LinkPreviewList event={message} />
    {/if}
  </div>

  {#if reactions || showThreadLink}
    <div class="chat-footer mt-0.5 flex items-center gap-2">
      {#if reactions}
        {@render reactions(message)}
      {/if}
      {#if showThreadLink}
        <button
          type="button"
          class="link text-xs link-primary"
          data-testid="thread-open"
          onclick={() => onOpenThread?.(message)}
        >
          {replyCountLabel}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Flash for a deep-linked message (added/removed by scrollToChatMessage in
     helpers/message-anchor.js — same visual language as comment-highlight). */
  :global(.chat-message-highlight .chat-bubble) {
    animation: chat-highlight-fade 2s ease-out;
  }

  @keyframes chat-highlight-fade {
    0% {
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-info) 60%, transparent);
    }
    100% {
      box-shadow: 0 0 0 3px transparent;
    }
  }
</style>
