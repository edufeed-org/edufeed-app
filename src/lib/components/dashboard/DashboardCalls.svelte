<!--
  DashboardCalls — calls running right now and meetings scheduled in the
  channels the user is a member of (issues wcszppsz, wc5tg66k). Renders
  nothing while there is neither.
-->
<script>
  import { resolve } from '$app/paths';
  import { VideoIcon, CalendarIcon } from '$lib/components/icons';
  import { useMyCalls } from '$lib/groups/my-calls.svelte.js';
  import { runningCalls, upcomingMeetings } from '$lib/groups/my-calls.js';
  import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { parentOf } from '$lib/groups/subtree-channels.js';
  import { metadataName } from '$lib/groups/unlinked-groups.js';
  import { groupHref } from '$lib/groups/groups.js';
  import { formatTimestamp, formatTimeOfDay } from '$lib/helpers/dates.js';
  import { moderatedCreationAvailable } from '$lib/groups/feature.js';
  import * as m from '$lib/paraglide/messages';

  const getCalls = useMyCalls();

  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const timer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  });

  const running = $derived(runningCalls(getCalls().pointers, getCalls().participantsByKey));
  const upcoming = $derived(upcomingMeetings(getCalls().events, getCalls().pointers, now));

  // Names only for the channels on screen, plus their community (the parent group).
  const shown = $derived([...running.map((r) => r.pointer), ...upcoming.map((u) => u.pointer)]);
  const getMeta = useChannelMetadata(() => shown);
  const parents = $derived(
    shown.flatMap((p) => {
      const parent = parentOf(getMeta().byKey[channelKey(p) ?? '']);
      return parent ? [{ id: parent, relay: p.relay }] : [];
    })
  );
  const getParentMeta = useChannelMetadata(() => parents);

  /** @param {{id: string, relay: string}} pointer */
  function names(pointer) {
    const meta = getMeta().byKey[channelKey(pointer) ?? ''];
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

  /** @param {{id: string, relay: string}} pointer */
  const href = (pointer) => resolve(/** @type {any} */ (groupHref(pointer)));
</script>

{#snippet channel(/** @type {{id: string, relay: string}} */ pointer)}
  {@const n = names(pointer)}
  <span class="truncate">
    {n.name}{#if n.community}
      <span class="text-base-content/60"> {m.home_calls_in({ name: n.community })}</span>{/if}
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
        <li class="flex items-center gap-3 px-4 py-3" data-testid="dashboard-call-running">
          <span class="status status-success" aria-hidden="true"></span>
          <div class="min-w-0 flex-1">
            <div class="flex font-semibold">{@render channel(call.pointer)}</div>
            <div class="text-sm text-base-content/60">
              {m.home_calls_people({ count: String(call.participants.length) })}
            </div>
          </div>
          <a class="btn btn-sm btn-primary" href={href(call.pointer)}>{m.home_calls_join()}</a>
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
