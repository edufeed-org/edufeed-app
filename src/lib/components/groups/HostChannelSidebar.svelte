<!--
  A host's channel list, in the app's second column.

  Opening a channel used to drop you into ONE chat with nothing beside it, so
  a relay with ten channels read as a dead end: the only way to the next
  channel was back out to the directory (laoc, 2026-08-06). Armada answers
  this with a persistent channel sidebar (ChannelSidebar.tsx), and this is
  that column.

  It takes the place of the app's generic nav on host routes — Home, Feed,
  Inbox and My Stuff are worth nothing while you are inside a host, and three
  nav columns beside a chat is one too many.

  Desktop only, like the community's ContentNavSidebar it replaces: on mobile
  the relay directory IS the channel list, and the chat header links back to
  it.

  The rows come from useHostChannels — the same merge the directory page
  renders, so the two can never disagree about what this host has.
-->
<script>
  import { groupHref } from '$lib/groups/groups.js';
  import {
    relayHref,
    relayDisplayName,
    relayIconUrl,
    announcesNip29
  } from '$lib/groups/relay-directory.js';
  import { relayBadges } from '$lib/groups/group-badges.js';
  import { splitChannelSections } from '$lib/groups/channel-sections.js';
  import { useHostChannels } from '$lib/groups/host-channels.svelte.js';
  import { useHostUnread } from '$lib/groups/host-unread.svelte.js';
  import ChannelRailRow from '$lib/components/community/channels/ChannelRailRow.svelte';
  // The Concord-prefixed name is a wart, and reusing it anyway is the point:
  // the two rails have to be indistinguishable, and one component is the only
  // way that stays true. Renaming it would churn ten Concord chrome files for
  // cosmetics, in a lane that owns none of them.
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import GroupBadges from '$lib/components/groups/GroupBadges.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * `host` is for a caller that already holds this host's channels — the
   * directory page does, for its card grid. Passing it keeps the route to ONE
   * relay subscription instead of two identical ones, which on a gated relay
   * would also mean two NIP-42 handshakes for one page.
   * @type {{relay: string | null, activeChannelId?: string | null, host?: any}}
   */
  let { relay, activeChannelId = null, host: given = null } = $props();

  // The hook is always called (a hook cannot be called conditionally) but idles
  // on a null relay, so a caller that supplies `host` opens nothing.
  const getOwn = useHostChannels(() => (given ? null : relay));
  const host = $derived(given ?? getOwn());
  const sections = $derived(splitChannelSections(host.rows));

  // Unread is read for the WHOLE host, not per section: the same one REQ
  // covers a DM and a channel, because on a NIP-29 relay they are the same
  // object. The ids come from the merged rows, so a channel the directory
  // lists and a channel unread watches can never be two different sets.
  // flatMap rather than filter().map(): a filter does not narrow the ChannelRow
  // union, and a Concord row has no pointer at all.
  const channelIds = $derived(
    host.rows.flatMap(
      (/** @type {import('$lib/groups/community-channel-rows.js').ChannelRow} */ row) =>
        row.source === 'group' ? [row.pointer.id] : []
    )
  );
  const getUnread = useHostUnread(
    () => relay,
    () => channelIds,
    () => activeChannelId
  );
  const unread = $derived(getUnread());
  const hostBadges = $derived(relayBadges(host.information));
  const title = $derived(relay ? relayDisplayName(host.information, relay) : '');
  const icon = $derived(relayIconUrl(host.information) ?? '');

  // "Nothing here", "nothing YET" and "the relay would not answer" are three
  // different sentences, and a host that simply has not replied must never
  // read as an empty one.
  const settling = $derived(host.loading && host.rows.length === 0);
  const notNip29 = $derived(announcesNip29(host.information) === false && host.rows.length === 0);
</script>

<div
  data-testid="host-channel-sidebar"
  class="hidden w-(--sidebar-nav-w) shrink-0 flex-col overflow-y-auto bg-base-200 lg:flex"
>
  <!-- The host's own picture and name, from its NIP-11 document — the same
       source the rail's icon reads, and the way back to the full directory. -->
  <a
    href={relay ? relayHref(relay) : '#'}
    data-testid="host-sidebar-header"
    class="flex items-center gap-3 p-4 transition-colors hover:bg-base-300/50"
  >
    <ImageWithFallback
      src={icon}
      alt=""
      fallbackType="community"
      class="h-9 w-9 shrink-0 rounded-xl object-cover"
    />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-semibold">{title}</span>
      <GroupBadges host={hostBadges} class="mt-0.5" />
    </span>
  </a>

  <!-- Only when there IS something to clear. A permanent control would be a
       button that does nothing most of the time, and while the host has not
       answered it would also be a claim that we know there is nothing. -->
  {#if unread.host.unread}
    <div class="px-3">
      <button
        type="button"
        data-testid="host-mark-all-read"
        class="btn w-full btn-ghost btn-xs"
        onclick={() => unread.markAllRead()}
      >
        {m.groups_mark_all_read()}
      </button>
    </div>
  {/if}

  <nav class="flex flex-col gap-1 px-3 pb-4">
    {#if host.authRefused && host.rows.length === 0}
      <p class="px-2 py-4 text-xs text-base-content/60" data-testid="host-sidebar-auth-refused">
        {m.relay_directory_auth_refused({ reason: host.authRefused })}
      </p>
    {:else if host.authRequired && host.rows.length === 0}
      <p class="px-2 py-4 text-xs text-base-content/60" data-testid="host-sidebar-auth">
        {m.relay_directory_auth_required()}
      </p>
    {:else if notNip29}
      <p class="px-2 py-4 text-xs text-base-content/60" data-testid="host-sidebar-not-nip29">
        {m.relay_directory_not_nip29()}
      </p>
    {:else if settling}
      <p class="px-2 py-4 text-xs text-base-content/60" data-testid="host-sidebar-loading">
        {m.relay_directory_loading()}
      </p>
    {:else if host.rows.length === 0}
      <p class="px-2 py-4 text-xs text-base-content/60" data-testid="host-sidebar-empty">
        {m.relay_directory_empty()}
      </p>
    {:else}
      {#each [{ id: 'channels', label: m.concord_rail_channels(), rows: sections.channels }, { id: 'dms', label: m.groups_rail_direct_messages(), rows: sections.dms }] as section (section.id)}
        <!-- A section only exists when the host has one. An empty "Direct
             messages" heading would be a section we invented: `t=dm` is a
             convention, and most hosts do not use it. -->
        {#if section.rows.length > 0}
          <div class="px-2 pt-3 pb-1" data-testid="host-sidebar-section-{section.id}">
            <span class="text-xs font-bold tracking-wider text-base-content/60 uppercase"
              >{section.label}</span
            >
          </div>
          {#each section.rows as row (row.key)}
            {#if row.source === 'group'}
              {@const flags = unread.flags(row.pointer.id)}
              <!-- `active` needs no `activeChannelId &&` guard: a row's id is
                   always a non-empty string (channelKey rejects anything
                   else), so the compare is already false on a directory
                   route. The guard was unreachable, and an unreachable line
                   is one no test can ever measure. -->
              <ChannelRailRow
                href={groupHref(row.pointer)}
                testid="host-channel-row"
                symbol={row.symbol}
                name={row.name}
                dimmed={row.pending}
                worldReadable={row.worldReadable}
                active={row.pointer.id === activeChannelId}
                bold={flags.unread}
              >
                {#snippet trailing()}
                  <ConcordUnreadDot unread={flags.unread} mentioned={flags.mentioned} />
                {/snippet}
              </ChannelRailRow>
            {/if}
          {/each}
        {/if}
      {/each}
    {/if}
  </nav>
</div>
