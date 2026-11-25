<!--
  DashboardCalls — calls running right now and meetings scheduled in the
  channels the user is a member of (issues wcszppsz, wc5tg66k). Renders
  nothing while there is neither.
-->
<script>
  import { resolve } from '$app/paths';
  import { VideoIcon, CalendarIcon } from '$lib/components/icons';
  import { useMyCalls } from '$lib/groups/my-calls.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runningCalls, upcomingMeetings } from '$lib/groups/my-calls.js';
  import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { parentOf } from '$lib/groups/subtree-channels.js';
  import { isTemporaryRoom } from '$lib/groups/breakout.js';
  import { unique } from '$lib/helpers/unique.js';
  import { metadataName } from '$lib/groups/unlinked-groups.js';
  import { resolveChannelHref } from '$lib/groups/group-added.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { formatTimestamp, formatTimeOfDay } from '$lib/helpers/dates.js';
  import { moderatedCreationAvailable } from '$lib/groups/feature.js';
  import * as m from '$lib/paraglide/messages';

  const calls = useMyCalls();
  const getActiveUser = useActiveUser();

  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const timer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  });

  // Names for all of my channels, not for the rows on screen: the row lists
  // are rebuilt on every clock tick and call change, and a lookup keyed on
  // them cleared every name and asked the relay again each time.
  const getMeta = useChannelMetadata(() => calls.pointers);
  /** @param {{id: string, relay: string}} pointer */
  const metaOf = (pointer) => getMeta().byKey[channelKey(pointer) ?? ''];

  // A row shows once its channel's metadata is here (so never as a bare id),
  // and never for a breakout room: that is its own group with its own call,
  // but people enter it through the main call, not through a link.
  /** @param {{pointer: {id: string, relay: string}}} row */
  const listed = (row) => !!metaOf(row.pointer) && !isTemporaryRoom(metaOf(row.pointer));
  const running = $derived(runningCalls(calls.pointers, calls.participantsByKey).filter(listed));
  const upcoming = $derived(
    upcomingMeetings(calls.events, calls.pointers, now, 50).filter(listed).slice(0, 5)
  );

  // The communities (parent groups) of my channels. Through a string, so the
  // list keeps its identity while the ids stay the same.
  const parentIds = $derived(
    JSON.stringify(
      unique(
        calls.pointers.flatMap((p) => {
          const parent = parentOf(metaOf(p));
          return parent ? [`${parent}\n${p.relay}`] : [];
        })
      )
    )
  );
  const parents = $derived(
    /** @type {string[]} */ (JSON.parse(parentIds)).map((entry) => {
      const [id, relay] = entry.split('\n');
      return { id, relay };
    })
  );
  const getParentMeta = useChannelMetadata(() => parents);

  /** @param {{id: string, relay: string}} pointer */
  function names(pointer) {
    const meta = metaOf(pointer);
    const parent = parentOf(meta);
    return {
      name: metadataName(meta) ?? pointer.id.slice(0, 8),
      community: parent
        ? metadataName(
            getParentMeta().byKey[channelKey({ id: parent, relay: pointer.relay }) ?? '']
          )
        : undefined
    };
  }

  // The communities I joined, as far as the store has them (the rail loads
  // them): a channel opens inside its community, not in the relay's channel
  // directory. Joined only — a 10222 is self-declared, and a stranger's could
  // name my channel as its root.
  const getJoined = useJoinedCommunitiesList();
  let communikeyEvents = $state.raw(/** @type {any[]} */ ([]));
  $effect(() => {
    const authors = getJoined();
    communikeyEvents = [];
    if (authors.length === 0) return;
    const sub = eventStore
      .model(TimelineModel, { kinds: [10222], authors })
      .subscribe((events) => (communikeyEvents = events ?? []));
    return () => sub.unsubscribe();
  });

  /** @param {{id: string, relay: string}} pointer */
  const href = (pointer) =>
    resolve(
      /** @type {any} */ (
        resolveChannelHref({ pointer, communikeyEvents, metadataEvent: metaOf(pointer) })
      )
    );
</script>

{#snippet channel(/** @type {{id: string, relay: string}} */ pointer)}
  {@const n = names(pointer)}
  <span class="truncate">
    {n.name}
    {#if n.community}
      <!-- ml-1, not a leading space: the template drops whitespace at the tag edge -->
      <span class="ml-1 text-base-content/60">{m.home_calls_in({ name: n.community })}</span>
    {/if}
  </span>
{/snippet}

{#if moderatedCreationAvailable() && (running.length > 0 || upcoming.length > 0)}
  <section class="mt-6" data-testid="dashboard-calls">
    <h2 class="mb-3.5 flex items-center gap-2 text-base font-bold">
      <VideoIcon class_="h-[17px] w-[17px] text-primary" />
      {m.home_calls_title()}
    </h2>
    <ul class="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100">
      {#each running as call (channelKey(call.pointer))}
        {@const inCall = call.participants.includes(getActiveUser()?.pubkey ?? '')}
        <li class="flex items-center gap-3 px-4 py-3" data-testid="dashboard-call-running">
          <span class="status status-success" aria-hidden="true"></span>
          <div class="min-w-0 flex-1">
            <div class="flex font-semibold">{@render channel(call.pointer)}</div>
            <div class="text-sm text-base-content/60">
              {inCall
                ? m.home_calls_people_with_me({ count: String(call.participants.length) })
                : m.home_calls_people({ count: String(call.participants.length) })}
            </div>
          </div>
          <!-- already in this call (another tab or device): open the channel, no second join -->
          {#if inCall}
            <a class="btn btn-ghost btn-sm" href={href(call.pointer)}>{m.home_calls_open()}</a>
          {:else}
            <a class="btn btn-sm btn-primary" href={href(call.pointer)}>{m.home_calls_join()}</a>
          {/if}
        </li>
      {/each}
      {#each upcoming as meeting (meeting.event.id)}
        <li class="flex items-center gap-3 px-4 py-3" data-testid="dashboard-call-meeting">
          <CalendarIcon class_="h-4 w-4 shrink-0 text-base-content/60" />
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold">{meeting.title}</div>
            <div class="flex gap-1 text-sm text-base-content/60">
              <span class="shrink-0">
                {#if meeting.started}
                  {m.home_calls_now()}
                {:else}
                  {formatTimestamp(meeting.start)}, {formatTimeOfDay(meeting.start)}
                {/if}
                ·
              </span>
              {@render channel(meeting.pointer)}
            </div>
          </div>
          <a class="btn btn-ghost btn-sm" href={href(meeting.pointer)}>{m.home_calls_open()}</a>
        </li>
      {/each}
    </ul>
  </section>
{/if}
