<!--
  ThreadCard Component
  Displays a thread (kind 11) as a list row matching Chateau forum layout:
  avatar | author + date | title | excerpt | tags | commenter summary
-->

<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { debounceTime } from 'rxjs/operators';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { getPlainTextExcerpt } from '$lib/helpers/commentThreading.js';
  import { ChatIcon } from '$lib/components/icons';
  import EventTags from '../calendar/EventTags.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {any} thread - Thread event (kind 11)
   * @property {any} [authorProfile] - Author's profile
   * @property {Map<string, any>} [commenterProfiles] - Map of pubkey → profile for commenters
   * @property {(event: any) => void} [onSelect] - Callback when card is clicked
   */

  /** @type {Props} */
  let { thread, authorProfile = null, commenterProfiles = new Map(), onSelect } = $props();

  // Comment count + commenter pubkeys via #E (root scope) timeline query.
  // Using #E instead of CommentsModel (#e) because some NIP-22 clients only
  // set the uppercase E tag on comments, missing the lowercase e parent tag.
  let commentCount = $state(0);
  let commenterPubkeys = $state(/** @type {string[]} */ ([]));

  $effect(() => {
    if (!thread?.id) return;

    const sub = eventStore
      .model(TimelineModel, { kinds: [1111], '#E': [thread.id] })
      .pipe(debounceTime(100))
      .subscribe((comments) => {
        commentCount = comments?.length || 0;
        const unique = [...new Set((comments || []).map((/** @type {any} */ c) => c.pubkey))];
        commenterPubkeys = unique;
      });

    return () => sub.unsubscribe();
  });

  // Derive commenter display info (max 3 avatars)
  const displayCommenters = $derived.by(() => {
    const max = 3;
    return commenterPubkeys.slice(0, max).map((pubkey) => {
      const profile = commenterProfiles.get(pubkey);
      return {
        pubkey,
        name: getDisplayName(profile, pubkey.slice(0, 8) + '...'),
        avatar: getProfilePicture(profile) || `https://robohash.org/${pubkey}`
      };
    });
  });

  const commenterSummaryText = $derived.by(() => {
    if (commenterPubkeys.length === 0) return '';
    const firstName = displayCommenters[0]?.name || '';
    if (commenterPubkeys.length === 1) return m.thread_card_commenter_single({ name: firstName });
    const othersCount = commenterPubkeys.length - 1;
    return m.thread_card_commenters_and_others({ name: firstName, count: othersCount });
  });

  // Extract thread title from tags
  const title = $derived(
    thread.tags?.find((/** @type {any} */ t) => t[0] === 'title')?.[1] || m.thread_card_untitled()
  );

  // Get content excerpt
  const excerpt = $derived(getPlainTextExcerpt(thread.content, 200));

  // Get hashtags
  const hashtags = $derived(
    thread.tags
      ?.filter((/** @type {any} */ t) => t[0] === 't')
      .map((/** @type {any} */ t) => t[1]) || []
  );

  // Author info
  const authorName = $derived(getDisplayName(authorProfile, thread.pubkey.slice(0, 8) + '...'));

  const relativeDate = $derived(formatRelativeTime(thread.created_at));

  /**
   * @param {MouseEvent} e
   */
  function handleClick(e) {
    if (onSelect && e.target instanceof HTMLElement && !e.target.closest('button, a')) {
      onSelect(thread);
    }
  }

  /**
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
      e.preventDefault();
      onSelect(thread);
    }
  }
</script>

<div
  class="thread-card flex cursor-pointer gap-3 px-4 py-4 transition-colors hover:bg-base-200"
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <!-- Author Avatar -->
  <div class="flex-shrink-0">
    <ProfileAvatar
      pubkey={thread.pubkey}
      profile={authorProfile}
      size="md"
      linkToProfile
      fallbackType="robohash"
    />
  </div>

  <!-- Content Column -->
  <div class="min-w-0 flex-1">
    <!-- Author + Date row -->
    <div class="flex items-center gap-2">
      <a
        href={resolve(profileLink(thread.pubkey))}
        class="truncate text-sm font-medium text-base-content hover:underline"
      >
        {authorName}
      </a>
      <span class="ml-auto shrink-0 text-xs text-base-content/50">{relativeDate}</span>
    </div>

    <!-- Title -->
    <h3 class="mt-0.5 line-clamp-2 text-base font-bold text-base-content">{title}</h3>

    <!-- Excerpt -->
    {#if excerpt}
      <p class="mt-1 line-clamp-2 text-sm text-base-content/60">{excerpt}</p>
    {/if}

    <!-- Tags -->
    {#if hashtags.length > 0}
      <div class="mt-2 flex flex-wrap gap-1">
        <EventTags tags={hashtags} size="sm" targetRoute="/discover" />
      </div>
    {/if}

    <!-- Commenter Summary -->
    {#if commentCount > 0}
      <div class="mt-2 flex items-center gap-2">
        <ChatIcon class_="h-4 w-4 shrink-0 text-base-content/40" />

        <!-- Stacked Avatars -->
        {#if displayCommenters.length > 0}
          <div class="flex -space-x-2">
            {#each displayCommenters as commenter (commenter.pubkey)}
              <ProfileAvatar
                pubkey={commenter.pubkey}
                profile={{ picture: commenter.avatar, name: commenter.name }}
                size="xs"
                linkToProfile
                showHoverCard={false}
                class="rounded-full border-2 border-base-100"
              />
            {/each}
          </div>
        {/if}

        <!-- Summary Text -->
        <span class="truncate text-xs text-base-content/50">{commenterSummaryText}</span>
        <span class="shrink-0 text-xs font-medium text-base-content/60">{commentCount}</span>
      </div>
    {/if}
  </div>
</div>
