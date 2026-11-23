<!--
  BotBadge — marks an account whose kind 0 declares `bot: true` (NIP-24).
  A label only: it never hides or ranks anyone.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /** @type {{ profile: any, class_?: string }} */
  let { profile, class_ = '' } = $props();
</script>

{#if profile?.bot === true}
  <span
    class="badge badge-ghost align-middle badge-sm font-normal {class_}"
    title={m.profile_bot_badge_title()}
    data-testid="bot-badge">{m.profile_bot_badge()}</span
  >
{/if}
