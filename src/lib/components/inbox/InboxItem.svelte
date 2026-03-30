<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getNotificationType, getNotificationUrl } from '$lib/helpers/inbox.js';
  import {
    HeartIcon,
    ChatIcon,
    CalendarIcon,
    BellIcon,
    ScrollTextIcon
  } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @type {{
   *   event: import('nostr-tools').NostrEvent,
   *   profile?: any,
   *   unread: boolean,
   *   contentTitle?: string,
   *   formName?: string
   * }}
   */
  let { event, profile, unread, contentTitle = '', formName = '' } = $props();

  const type = $derived(getNotificationType(event));
  const url = $derived(getNotificationUrl(event));
  const displayName = $derived(profile?.display_name || profile?.name || event.pubkey.slice(0, 8));

  /** @type {Record<string, typeof BellIcon>} */
  const iconMap = {
    formRequest: ScrollTextIcon,
    formResponse: ScrollTextIcon,
    reaction: HeartIcon,
    comment: ChatIcon,
    mention: BellIcon,
    rsvp: CalendarIcon
  };

  const TypeIcon = $derived(type ? iconMap[type] || BellIcon : BellIcon);

  function handleClick() {
    if (url) goto(resolve(url));
  }

  /**
   * @param {number} ts
   * @returns {string}
   */
  function formatTime(ts) {
    const diff = Date.now() / 1000 - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
</script>

<button
  class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-base-200/50
    {unread
    ? 'border-l-3 border-primary bg-primary/5'
    : 'border-l-3 border-transparent opacity-60'}"
  onclick={handleClick}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="mt-0.5 flex-shrink-0" onclick={(e) => e.stopPropagation()}>
    {#if profile}
      <ProfileAvatar pubkey={event.pubkey} {profile} size="sm" linkToProfile />
    {:else}
      <div class="flex h-9 w-9 items-center justify-center rounded-full bg-base-300">
        <TypeIcon class_="h-4 w-4 text-base-content/50" />
      </div>
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    <div class="text-sm leading-snug">
      <span class="font-medium">{displayName}</span>
      {#if type === 'formRequest'}
        &nbsp;{m.inbox_action_form_request({ formName: formName || '' })}
      {:else if type === 'formResponse'}
        &nbsp;{m.inbox_action_form_response({ formName: formName || '' })}
      {:else if type === 'reaction'}
        &nbsp;{m.inbox_action_reaction({ contentTitle })}
      {:else if type === 'comment'}
        &nbsp;{m.inbox_action_comment({ contentTitle })}
      {:else if type === 'mention'}
        &nbsp;{m.inbox_action_mention({ communityName: contentTitle })}
      {:else if type === 'rsvp'}
        &nbsp;{m.inbox_action_rsvp({ eventTitle: contentTitle })}
      {/if}
    </div>
    <div class="mt-0.5 text-xs text-base-content/50">{formatTime(event.created_at)}</div>
  </div>
  {#if unread}
    <div class="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-primary"></div>
  {/if}
</button>
