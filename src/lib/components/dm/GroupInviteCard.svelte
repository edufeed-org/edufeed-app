<!--
  GroupInviteCard — a group invite DM (see invite-link.js) rendered as a card
  instead of prose. The generic content renderer turned the join URL into a
  profile chip and lost the `?join=` code with it; here the CTA keeps the URL
  exactly as sent, so CommunityProfileHero can prefill the invite code.
-->
<script>
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from '$lib/helpers/displayName.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { CopyIcon, CheckIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ invite: import('$lib/groups/invite-link.js').GroupInvite }} */
  let { invite } = $props();

  const getProfile = useUserProfile(() => invite.communityPubkey);
  const name = $derived(getDisplayName(getProfile(), invite.communityPubkey));

  let copied = $state(false);
  async function copyNaddr() {
    if (!invite.naddr) return;
    try {
      await navigator.clipboard.writeText(`nostr:${invite.naddr}`);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
</script>

<div class="flex flex-col gap-3" data-testid="dm-group-invite">
  <div class="flex items-center gap-3">
    <ProfileAvatar pubkey={invite.communityPubkey} profile={getProfile()} size="md" />
    <div class="min-w-0">
      <div class="text-xs uppercase opacity-70">{m.group_invite_card_label()}</div>
      <div class="font-medium">{m.group_invite_card_body({ name })}</div>
    </div>
  </div>
  <a href={invite.joinUrl} class="btn self-start btn-sm btn-primary" data-testid="group-invite-cta">
    {m.group_invite_card_cta()}
  </a>
  {#if invite.naddr}
    <div class="flex items-center gap-1 text-xs opacity-70" data-testid="group-invite-naddr">
      <span class="shrink-0">{m.group_invite_card_other_clients()}</span>
      <code class="min-w-0 truncate">nostr:{invite.naddr}</code>
      <button
        type="button"
        class="btn shrink-0 btn-ghost btn-xs"
        onclick={copyNaddr}
        title={copied ? m.common_copied() : m.common_copy()}
        aria-label={copied ? m.common_copied() : m.common_copy()}
      >
        {#if copied}<CheckIcon class_="h-3.5 w-3.5" />{:else}<CopyIcon class_="h-3.5 w-3.5" />{/if}
      </button>
    </div>
  {/if}
</div>
