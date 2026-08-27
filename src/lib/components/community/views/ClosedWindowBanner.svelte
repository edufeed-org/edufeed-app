<!--
  ClosedWindowBanner — the outsider's one-line orientation on a "Privat mit
  Schaufenster" community's home: what they see below is the community's
  public window (curated by consenting publishers), and membership itself is
  invite-only. Replaces the ClosedCommunityShell lock-wall for closed
  communities that DO have window sections (MainContentArea decides) — the
  wall told visitors there is nothing to see while public content sat right
  behind it.
-->
<script>
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent } = $props();

  let ownerHref = $derived.by(() => {
    if (!communikeyEvent?.pubkey) return null;
    try {
      return `/p/${nip19.npubEncode(communikeyEvent.pubkey)}`;
    } catch {
      return null;
    }
  });
</script>

<div
  class="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-base-300 bg-base-100 px-4 py-2.5"
  data-testid="closed-window-banner"
>
  <span class="text-sm font-semibold">🪟 {m.community_type_closed_window_title()}</span>
  <span class="text-sm text-base-content/70">{m.closed_window_banner_body()}</span>
  {#if ownerHref}
    <a class="link text-sm link-primary" href={ownerHref}>{m.community_shell_contact_owner()}</a>
  {/if}
</div>
