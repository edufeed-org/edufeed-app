<script>
  import { resolve } from '$app/paths';
  import { getNotificationType, getNotificationUrl } from '$lib/helpers/inbox.js';
  import { markItemAsRead } from '$lib/services/inbox-service.svelte.js';
  import { publishWave } from '$lib/helpers/waves.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { showToast } from '$lib/helpers/toast';
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
    mention: BellIcon,
    rsvp: CalendarIcon
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
      <span class="font-medium">{displayName}</span>
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
      {:else if type === 'mention'}
        &nbsp;{m.inbox_action_mention({ communityName: contentTitle })}
      {:else if type === 'rsvp'}
        &nbsp;{m.inbox_action_rsvp({ eventTitle: contentTitle })}
      {/if}
    </div>
    <div class="mt-0.5 flex items-center gap-2">
      <span class="text-xs text-base-content/50">{formatTime(event.created_at)}</span>
      {#if type === 'wave'}
        <button
          class="btn transition-colors btn-xs {wavedBack ? 'text-white btn-success' : 'btn-ghost'}"
          onclick={handleWaveBack}
        >
          👋 {wavedBack ? m.wave_success() : m.wave_back_button()}
        </button>
      {/if}
    </div>
  </div>
  {#if unread}
    <div
      role="button"
      tabindex="-1"
      class="mt-2 h-2 w-2 flex-shrink-0 cursor-pointer rounded-full bg-primary transition-transform hover:scale-150 hover:ring-4 hover:ring-primary/20"
      aria-label={m.inbox_mark_read()}
      onclick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const parentLink = /** @type {HTMLElement | null} */ (e.currentTarget.closest('a'));
        markItemAsRead(event.id);
        parentLink?.focus();
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          e.preventDefault();
          const parentLink = /** @type {HTMLElement | null} */ (e.currentTarget.closest('a'));
          markItemAsRead(event.id);
          parentLink?.focus();
        }
      }}
    ></div>
  {/if}
</a>
