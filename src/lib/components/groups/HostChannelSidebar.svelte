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
  import ChannelRailRow from '$lib/components/community/channels/ChannelRailRow.svelte';
  import GroupBadges from '$lib/components/groups/GroupBadges.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{relay: string | null, activeChannelId?: string | null}} */
  let { relay, activeChannelId = null } = $props();

  const getHost = useHostChannels(() => relay);
  const host = $derived(getHost());
  const sections = $derived(splitChannelSections(host.rows));
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
              />
            {/if}
          {/each}
        {/if}
      {/each}
    {/if}
  </nav>
</div>
