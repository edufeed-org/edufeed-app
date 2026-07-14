<!--
  HighlightCard — compact card for a single kind-9802 highlight (issue #45).
  Used by FeedEntryCard for the Highlights category and for reposts of
  highlights. Tag reading goes through applesauce helpers only.
-->
<script>
  import { nip19 } from 'nostr-tools';
  import { getDisplayName } from 'applesauce-core/helpers';
  import {
    getHighlightSourceUrl,
    getHighlightSourceAddressPointer
  } from 'applesauce-common/helpers';
  import { resolve } from '$app/paths';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';

  /** @type {{ event: any, authorProfile?: any }} */
  let { event, authorProfile = null } = $props();

  const getInternalProfile = useUserProfile(() => (authorProfile ? null : event.pubkey));
  const profile = $derived(authorProfile ?? getInternalProfile());

  const sourceUrl = $derived(getHighlightSourceUrl(event));
  const sourceHref = $derived.by(() => {
    if (sourceUrl) return sourceUrl;
    const pointer = getHighlightSourceAddressPointer(event);
    if (!pointer) return null;
    try {
      return resolve(`/${nip19.naddrEncode(pointer)}`);
    } catch {
      return null;
    }
  });
  const sourceLabel = $derived(sourceUrl ? new URL(sourceUrl).hostname : null);
</script>

<div class="rounded-lg border border-base-300 bg-base-100 p-4 shadow-sm">
  <div class="border-l-3 border-warning bg-warning/5 py-1 pl-3">
    <p class="text-sm text-base-content/80 italic">&ldquo;{event.content}&rdquo;</p>
  </div>
  <div class="mt-2 flex items-center justify-between gap-2 text-xs text-base-content/50">
    <div class="flex items-center gap-1.5">
      <ProfileAvatar
        pubkey={event.pubkey}
        {profile}
        size="xs"
        linkToProfile
        fallbackType="robohash"
      />
      <span>{getDisplayName(profile) || event.pubkey.slice(0, 8) + '…'}</span>
      <span>·</span>
      <span>{formatRelativeTime(event.created_at)}</span>
    </div>
    {#if sourceHref}
      <a
        href={sourceHref}
        target={sourceUrl ? '_blank' : undefined}
        rel={sourceUrl ? 'noopener noreferrer' : undefined}
        class="link truncate link-primary"
      >
        {sourceLabel || sourceHref.slice(0, 40)}
      </a>
    {/if}
  </div>
</div>
