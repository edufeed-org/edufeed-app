<script>
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { getNotificationType, getNotificationUrl } from '$lib/helpers/inbox.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { markItemAsRead } from '$lib/services/inbox-service.svelte.js';
  import { publishWave } from '$lib/helpers/waves.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { showToast } from '$lib/helpers/toast';
  import {
    HeartIcon,
    ChatIcon,
    CalendarIcon,
    BellIcon,
    ScrollTextIcon,
    PollIcon
  } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import UnreadDot from '$lib/components/shared/UnreadDot.svelte';
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
  const href = $derived(url ? resolve(/** @type {any} */ (url)) : undefined);
  const displayName = $derived(profile?.display_name || profile?.name || event.pubkey.slice(0, 8));

  let wavedBack = $state(false);

  /** @type {Record<string, any>} */
  const iconMap = {
    formRequest: ScrollTextIcon,
    formResponse: ScrollTextIcon,
    wave: BellIcon,
    reaction: HeartIcon,
    comment: ChatIcon,
    reply: ChatIcon,
    mention: BellIcon,
    rsvp: CalendarIcon,
    pollVote: PollIcon
  };

  const TypeIcon = $derived(type ? iconMap[type] || BellIcon : BellIcon);

  /** @param {MouseEvent} e */
  function handleClick(e) {
    markItemAsRead(event.id);
    if (!href) e.preventDefault();
  }

  /** @param {MouseEvent} e */
  function handleWaveBack(e) {
    e.stopPropagation();
    e.preventDefault();
    if (wavedBack) return;
    wavedBack = true;

    new Promise((resolve, reject) => {
      /** @type {import('rxjs').Subscription | undefined} */
      let sub;
      sub = eventStore.replaceable(0, event.pubkey).subscribe((ev) => {
        if (ev) {
          sub?.unsubscribe();
          resolve(ev);
        }
      });
      setTimeout(() => {
        sub?.unsubscribe();
        reject(new Error('Profile not found'));
      }, 3000);
    })
      .then((profileEvent) => publishWave(/** @type {any} */ (profileEvent)))
      .then(() => showToast(m.wave_success(), 'success'))
      .catch((err) => {
        console.error('Failed to wave back:', err);
        wavedBack = false;
        showToast(m.wave_error(), 'error');
      });
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

<a
  href={href || '#'}
  data-sveltekit-preload-data="hover"
  class="flex w-full items-start gap-3 px-4 py-3 text-left no-underline transition-colors hover:bg-base-200/50
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
      <!-- The row is already an <a>; anchors cannot nest, so navigate via goto -->
      <span
        role="link"
        tabindex="0"
        class="cursor-pointer font-medium hover:underline"
        onclick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          goto(resolve(profileLink(event.pubkey)));
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            goto(resolve(profileLink(event.pubkey)));
          }
        }}>{displayName}</span
      >
      {#if type === 'formRequest'}
        &nbsp;{m.inbox_action_form_request({ formName: formName || '' })}
      {:else if type === 'formResponse'}
        &nbsp;{m.inbox_action_form_response({ formName: formName || '' })}
      {:else if type === 'wave'}
        &nbsp;{m.inbox_action_wave()}
      {:else if type === 'reaction'}
        &nbsp;{m.inbox_action_reaction({ contentTitle })}
      {:else if type === 'comment'}
        &nbsp;{m.inbox_action_comment({ contentTitle })}
      {:else if type === 'reply'}
        &nbsp;{m.inbox_action_reply()}
      {:else if type === 'mention'}
        <!-- kind 9 mentions happen inside a community, kind 1 mentions do not -->
        &nbsp;{event.kind === 1
          ? m.inbox_action_note_mention()
          : m.inbox_action_mention({ communityName: contentTitle })}
      {:else if type === 'rsvp'}
        &nbsp;{m.inbox_action_rsvp({ eventTitle: contentTitle })}
      {:else if type === 'pollVote'}
        &nbsp;{m.inbox_action_poll_vote()}
      {/if}
    </div>
    <div class="mt-0.5 flex items-center gap-2">
      <span class="text-xs text-base-content/50">{formatTime(event.created_at)}</span>
      {#if type === 'wave'}
        <button
          class="btn transition-colors btn-xs {wavedBack ? 'btn-success' : 'btn-ghost'}"
          onclick={handleWaveBack}
        >
          👋 {wavedBack ? m.wave_success() : m.wave_back_button()}
        </button>
      {/if}
    </div>
  </div>
  {#if unread}
    <UnreadDot onclick={() => markItemAsRead(event.id)} />
  {/if}
</a>
