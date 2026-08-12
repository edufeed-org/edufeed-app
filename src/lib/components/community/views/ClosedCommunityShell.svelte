<!--
  ClosedCommunityShell — the "home" view of a closed community for anyone who
  is not (yet) a member: identity (avatar/name/description), the closed
  badge, an explainer, and a way to reach the owner. Closed communities have
  no readable content tabs for a non-member (see getCommunityTabs), so this
  IS the whole page — no join button (kind-30000 follow join is meaningless
  for closed communities; membership comes via Concord invite, a later task).

  Reuses the profile-reading idiom CommunityProfileHero uses
  (getDisplayName/getProfilePicture from applesauce-core/helpers +
  ImageWithFallback) rather than a new loader — communikeyEvent/communityProfile
  are already loaded by the c/[pubkey] layout and passed down as props.
-->
<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { nip19 } from 'nostr-tools';
  import ImageWithFallback from '../../shared/ImageWithFallback.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent, communityProfile } = $props();

  let displayName = $derived(getDisplayName(communityProfile) || 'Community');
  let avatarUrl = $derived(getProfilePicture(communityProfile));
  let description = $derived(communikeyEvent?.content || '');

  // /p/<npub> — the route accepts hex too, but npub is the canonical form
  // other components link to a profile with.
  let ownerHref = $derived.by(() => {
    if (!communikeyEvent?.pubkey) return null;
    try {
      return `/p/${nip19.npubEncode(communikeyEvent.pubkey)}`;
    } catch {
      return null;
    }
  });
</script>

<div data-testid="closed-community-shell" class="flex h-full items-center justify-center p-8">
  <div class="max-w-md text-center">
    <div class="avatar mx-auto mb-4">
      <div class="w-16 rounded-full ring-2 ring-base-100">
        {#if avatarUrl}
          <ImageWithFallback
            src={avatarUrl}
            alt={displayName}
            size="avatar_lg"
            class="h-full w-full rounded-full object-cover"
          />
        {:else}
          <div
            class="flex h-full w-full items-center justify-center bg-primary/20 text-xl font-bold text-primary"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        {/if}
      </div>
    </div>

    <div class="mb-2 flex items-center justify-center gap-2">
      <h2 class="text-xl font-extrabold tracking-tight text-base-content">{displayName}</h2>
      <div class="badge gap-1 badge-sm badge-neutral">
        {m.community_type_closed_title()}
      </div>
    </div>

    {#if description}
      <p class="mb-4 text-sm text-base-content/70">{description}</p>
    {/if}

    <p class="mb-6 text-sm text-base-content/80">
      {m.community_shell_lead()}
    </p>

    {#if ownerHref}
      <a href={ownerHref} class="btn btn-sm btn-primary">
        {m.community_shell_contact_owner()}
      </a>
    {/if}

    <p class="mt-4 text-xs text-base-content/50">
      {m.community_shell_invite_future()}
    </p>
  </div>
</div>
