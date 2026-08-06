<!--
  The channel overview — what a community extended by NIP-29 groups shows
  before you pick a channel. Armada puts the same thing on a server's home
  (ServerPage.tsx): what the HOST announces about itself, then one card per
  channel. This pane used to be a bare "pick a channel from the list" placard,
  which said nothing the rail beside it did not already say.

  Presentational on purpose: rows come from buildChannelRows, the host badges
  from the caller. GROUP rows only — this pane is rendered exactly when the
  community has NIP-29 channels and no Concord area, so a concord row cannot
  reach it, and a card that handled one would be a shape no route mounts.

  A card names the access level in words, which the rail's glyph cannot: '#'
  stands for both "world-readable" and "everyone in this community". The words
  are the ones the attach wizard already uses for the same choice — same
  statement, one wording.
-->
<script>
  import { groupHref } from '$lib/groups/groups.js';
  import GroupBadges from '$lib/components/groups/GroupBadges.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   rows?: import('$lib/groups/community-channel-rows.js').ChannelRow[],
   *   hostBadges?: import('$lib/groups/group-badges.js').Badge[]
   * }}
   */
  let { rows = [], hostBadges = [] } = $props();

  const channels = $derived(/** @type {any[]} */ (rows).filter((row) => row.source === 'group'));

  /** @param {string} level */
  function accessLabel(level) {
    if (level === 'world') return m.groups_badge_world_readable();
    if (level === 'members') return m.groups_attach_access_members();
    if (level === 'invited') return m.groups_attach_access_invited();
    // Metadata still on its way. Never guessed open — the row is drawn locked
    // meanwhile and says so.
    return m.groups_badge_access_pending();
  }
</script>

<div class="flex-1 overflow-y-auto p-6">
  <div class="mx-auto max-w-3xl">
    <header class="mb-5">
      <h2 class="text-xl font-extrabold" data-testid="channel-overview-title">
        {m.groups_overview_title()}
      </h2>
      <p class="mt-1 text-sm text-base-content/60">{m.groups_overview_lead()}</p>
      <GroupBadges host={hostBadges} class="mt-2" />
    </header>

    {#if channels.length === 0}
      <p
        class="rounded-2xl border border-dashed border-base-300 p-8 text-center text-sm text-base-content/60"
      >
        {m.groups_overview_empty()}
      </p>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        {#each channels as row (row.key)}
          <a
            href={groupHref(row.pointer)}
            data-testid="channel-card"
            class="flex flex-col gap-2 rounded-2xl border border-base-300 bg-base-100 p-4 transition-colors hover:border-primary/50"
          >
            <span class="flex items-center gap-2">
              <span aria-hidden="true" class="opacity-70">{row.symbol}</span>
              <span class="min-w-0 flex-1 truncate font-bold {row.pending ? 'opacity-50' : ''}"
                >{row.name}</span
              >
              {#if row.worldReadable}
                <span
                  aria-hidden="true"
                  data-testid="world-readable-badge"
                  title={m.groups_channel_world_readable()}
                  class="shrink-0 text-[0.7rem] opacity-80">&#127760;</span
                >
              {/if}
            </span>
            {#if row.about}
              <span class="line-clamp-2 text-sm text-base-content/60">{row.about}</span>
            {/if}
            <span class="badge badge-outline badge-xs" data-testid="channel-card-access"
              >{accessLabel(row.level)}</span
            >
          </a>
        {/each}
      </div>
    {/if}
  </div>
</div>
