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
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import ChannelCallBadge from '$lib/components/groups/call/ChannelCallBadge.svelte';
  import ChannelCallRoster from '$lib/components/groups/call/ChannelCallRoster.svelte';
  import { StarIcon, TrashIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   rows?: import('$lib/groups/community-channel-rows.js').ChannelRow[],
   *   hostBadges?: import('$lib/groups/group-badges.js').Badge[],
   *   titleIcon?: string,
   *   title?: string,
   *   lead?: string,
   *   empty?: string,
   *   onSelect?: ((pointer: {id: string, relay: string}) => void) | null,
   *   isFavourite?: ((row: any) => boolean) | null,
   *   onToggleFavourite?: ((row: any) => void) | null,
   *   canDelete?: ((row: any) => boolean) | null,
   *   onDelete?: ((pointer: {id: string, relay: string, name?: string}) => void) | null,
   *   actions?: import('svelte').Snippet | null
   * }}
   */
  // The relay directory renders the same grid under a different heading — a
  // host is not a community, and saying "in this community" over a relay's
  // channel list would name the wrong container. Defaults keep every existing
  // call site unchanged.
  //
  // onSelect: the community pane picks channels in place (selection store)
  // instead of leaving for /groups — cards become buttons there. Without it
  // (the relay directory), cards stay links to the standalone route, which
  // is exactly what browsing a host is for.
  //
  // isFavourite/onToggleFavourite, canDelete/onDelete: the community pane's
  // per-channel star and admin delete. These cards are the channel list at
  // every width (QA 2026-10-02 C-new-7 retired the phone rail that carried
  // them), so the actions moved here. They render as SIBLINGS of the card
  // button, overlaid on its top-right corner — never nested inside it.
  let {
    rows = [],
    hostBadges = [],
    titleIcon = '',
    title = m.groups_overview_title(),
    lead = m.groups_overview_lead(),
    empty = m.groups_overview_empty(),
    onSelect = null,
    isFavourite = null,
    onToggleFavourite = null,
    canDelete = null,
    onDelete = null,
    actions = null
  } = $props();

  /** @param {any} row */
  const deletable = (row) => !!onDelete && !!canDelete?.(row);
  /** @param {any} row */
  const actionCount = (row) => (onToggleFavourite ? 1 : 0) + (deletable(row) ? 1 : 0);

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
      <h2
        class="flex items-center gap-3 text-xl font-extrabold"
        data-testid="channel-overview-title"
      >
        {#if titleIcon}
          <span class="shrink-0" data-testid="channel-overview-icon">
            <ImageWithFallback
              src={titleIcon}
              alt=""
              fallbackType="community"
              class="h-10 w-10 rounded-xl object-cover"
            />
          </span>
        {/if}
        {title}
      </h2>
      <p class="mt-1 text-sm text-base-content/60">{lead}</p>
      <GroupBadges host={hostBadges} class="mt-2" />
      <!-- The caller's list-level actions (members, "+ Neuer Kanal"), in the
           same centred column as the cards. -->
      {#if actions}
        <div class="mt-3 flex flex-wrap gap-2" data-testid="channel-overview-actions">
          {@render actions()}
        </div>
      {/if}
    </header>

    {#if channels.length === 0}
      <p
        class="rounded-2xl border border-dashed border-base-300 p-8 text-center text-sm text-base-content/60"
      >
        {empty}
      </p>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        {#each channels as row (row.key)}
          {@const starred = !!isFavourite?.(row)}
          <!-- The wrap draws the card frame, so the call roster below the card
               button reads as part of the card while staying its sibling. -->
          <div
            class="relative flex min-w-0 flex-col rounded-2xl border border-base-300 bg-base-100 transition-colors hover:border-primary/50"
            data-testid="channel-card-wrap"
          >
            <svelte:element
              this={onSelect ? 'button' : 'a'}
              role={onSelect ? 'button' : undefined}
              href={onSelect ? undefined : groupHref(row.pointer)}
              onclick={onSelect ? () => onSelect(row.pointer) : undefined}
              data-testid="channel-card"
              class="flex w-full flex-1 flex-col gap-2 rounded-2xl p-4 text-left"
            >
              <!-- Room on the right for the overlaid actions (2rem each). -->
              <span
                class="flex items-center gap-2 {actionCount(row) === 2
                  ? 'pr-16'
                  : actionCount(row) === 1
                    ? 'pr-8'
                    : ''}"
              >
                {#if row.picture}
                  <!-- The channel's own picture, when its kind:39000 carries
                     one. The glyph stays: it is the access level, which a
                     picture cannot say. -->
                  <span class="shrink-0" data-testid="channel-card-picture">
                    <ImageWithFallback
                      src={row.picture}
                      alt=""
                      fallbackType="community"
                      class="h-8 w-8 rounded-lg object-cover"
                    />
                  </span>
                {/if}
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
                <span
                  data-testid="channel-card-topic"
                  class="line-clamp-2 text-sm text-base-content/60">{row.about}</span
                >
              {/if}
              <span class="flex flex-wrap items-center gap-2">
                <span class="badge badge-outline badge-xs" data-testid="channel-card-access"
                  >{accessLabel(row.level)}</span
                >
                <!-- The relay directory's cards (links, no onSelect) show the
                passive count; the community pane's carry the full roster
                below instead. -->
                {#if row.av && !onSelect}
                  <ChannelCallBadge pointer={row.pointer} />
                {/if}
              </span>
            </svelte:element>
            <!-- These cards are the community's channel list on every width
              (C-new-7), so a running call gets the rail's full roster here:
              who is in it and the one-click Join / "Anruf anzeigen" / "Du
              bist im Anruf" states (Task 13). A sibling of the card button,
              never inside it. AV rows only: each roster holds a standing
              kind-39004 subscription. -->
            {#if row.av && onSelect}
              <ChannelCallRoster
                pointer={row.pointer}
                name={row.name}
                onOpen={() => onSelect?.(row.pointer)}
                inset="px-4 pb-3"
              />
            {/if}
            {#if actionCount(row) > 0}
              <div class="absolute top-2.5 right-2.5 flex items-center gap-0.5">
                {#if deletable(row)}
                  <button
                    type="button"
                    class="btn btn-square text-base-content/50 btn-ghost btn-sm hover:text-error"
                    data-testid="group-channel-delete"
                    title={m.groups_channel_delete()}
                    aria-label={m.groups_channel_delete()}
                    onclick={() => onDelete?.(row.pointer)}
                  >
                    <TrashIcon class="h-4 w-4" />
                  </button>
                {/if}
                {#if onToggleFavourite}
                  <button
                    type="button"
                    class="btn btn-square btn-ghost btn-sm {starred
                      ? 'text-accent'
                      : 'text-base-content/40'}"
                    data-testid="channel-favourite-toggle"
                    aria-pressed={starred}
                    title={starred
                      ? m.groups_channel_favourite_remove()
                      : m.groups_channel_favourite_add()}
                    aria-label={starred
                      ? m.groups_channel_favourite_remove()
                      : m.groups_channel_favourite_add()}
                    onclick={() => onToggleFavourite?.(row)}
                  >
                    <StarIcon class_="w-4 h-4" filled={starred} title="" />
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
