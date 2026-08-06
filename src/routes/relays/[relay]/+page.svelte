<!--
  A relay's channel directory — the NIP-29 container we did not have.

  Each NIP-29 channel is its own group with no parent object, so the only
  thing that holds a set of them together is the host. Opening a group used to
  drop you straight into ONE chat, which is why a relay with ten channels
  looked like one channel: we only ever drew what the user's own kind-10009
  named. This page asks the relay itself.

  The card grid and the host badges are the ones the community channel
  overview already uses — a channel list is a channel list, and the reader
  should not be able to tell which container produced it.
-->
<script>
  import { isValidRelayUrl } from '$lib/groups/groups.js';
  import { relayLabel } from '$lib/groups/relay-directory.js';
  import { useRelayDirectory } from '$lib/groups/relay-directory.svelte.js';
  import { useMyGroups } from '$lib/groups/unlinked-groups.svelte.js';
  import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { relayBadges } from '$lib/groups/group-badges.js';
  import ChannelOverview from '$lib/components/community/channels/ChannelOverview.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();

  const relay = $derived(isValidRelayUrl(data.rawRelay) ? data.rawRelay : null);

  // The user's own list, narrowed to THIS relay: it is one of the three
  // sources, and the only one that can name a channel the relay hides.
  const getMyGroups = useMyGroups();
  const remembered = $derived(
    getMyGroups()
      .filter((group) => group.relay === relay)
      .map((group) => group.id)
  );

  const getDirectory = useRelayDirectory(
    () => relay,
    () => remembered
  );
  const directory = $derived(getDirectory());

  const getInformation = useRelayInformation(() => relay);
  const hostBadges = $derived(relayBadges(getInformation()));

  // Metadata events -> the same row shape the community overview renders, so
  // the glyph, the access wording and the "still loading" state are decided in
  // exactly one place for both containers.
  const rows = $derived.by(() => {
    if (!relay) return [];
    /** @type {Record<string, any>} */
    const metadataByKey = {};
    /** @type {Array<{id: string, relay: string}>} */
    const pointers = [];
    for (const event of directory.metadata) {
      const id = (event?.tags ?? []).find((/** @type {string[]} */ t) => t?.[0] === 'd')?.[1];
      if (!id) continue;
      const pointer = { id, relay };
      const key = channelKey(pointer);
      if (!key) continue;
      metadataByKey[key] = event;
      pointers.push(pointer);
    }
    return buildChannelRows({ groupPointers: pointers, metadataByKey });
  });

  // "Nothing here" and "nothing YET" are different sentences, and a relay that
  // simply has not answered must never render as an empty host.
  const settling = $derived(directory.loading && rows.length === 0);
</script>

<svelte:head>
  <title>{relay ? relayLabel(relay) : 'Relay'} — edufeed</title>
</svelte:head>

{#if !relay}
  <div class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-invalid">
    {m.relay_directory_invalid()}
  </div>
{:else}
  <div class="flex h-[calc(100vh-4rem)] flex-col">
    <!-- A refusal is the relay's own sentence and says more than ours would;
         "sign in" is only right when nobody has tried yet. Both beat a
         spinner that can never end: a gated request emits nothing at all. -->
    {#if directory.authRefused && rows.length === 0}
      <p class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-auth-refused">
        {m.relay_directory_auth_refused({ reason: directory.authRefused })}
      </p>
    {:else if directory.authRequired && rows.length === 0}
      <p class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-auth">
        {m.relay_directory_auth_required()}
      </p>
    {:else if settling}
      <p class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-loading">
        {m.relay_directory_loading()}
      </p>
    {:else}
      <ChannelOverview
        {rows}
        {hostBadges}
        title={relayLabel(relay)}
        lead={m.relay_directory_lead()}
        empty={m.relay_directory_empty()}
      />
    {/if}
  </div>
{/if}
