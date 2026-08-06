<!--
  The small labels of a NIP-29 group, rendered from the ids that
  $lib/groups/group-badges.js hands out.

  Two surfaces show them — a group's own home (GroupChat) and the community's
  channel overview (ChannelOverview) — and the wording must not drift between
  them, so the id -> text mapping lives here once. The `software` badge is the
  one whose text comes from the relay itself and is therefore never translated.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   access?: import('$lib/groups/group-badges.js').Badge[],
   *   host?: import('$lib/groups/group-badges.js').Badge[],
   *   class?: string
   * }}
   */
  let { access = [], host = [], class: className = '' } = $props();
</script>

{#if access.length || host.length}
  <div class="flex flex-wrap items-center gap-1 {className}" data-testid="group-badges">
    {#each access as badge (badge.id)}
      <span class="badge badge-outline badge-xs" data-testid="group-badge-{badge.id}">
        {badge.id === 'members' ? m.groups_badge_members_only() : m.groups_badge_invite_only()}
      </span>
    {/each}
    {#each host as badge (badge.id)}
      <span class="badge badge-ghost badge-xs" data-testid="group-badge-{badge.id}">
        {#if badge.id === 'auth'}{m.groups_badge_auth_required()}
        {:else if badge.id === 'nip29'}{m.groups_badge_nip29()}
        {:else}{badge.text}{/if}
      </span>
    {/each}
  </div>
{/if}
