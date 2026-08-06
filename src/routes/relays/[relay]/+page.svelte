<!--
  A relay's channel directory — the NIP-29 container we did not have.

  Each NIP-29 channel is its own group with no parent object, so the only
  thing that holds a set of them together is the host. Opening a group used to
  drop you straight into ONE chat, which is why a relay with ten channels
  looked like one channel: we only ever drew what the user's own kind-10009
  named. This page asks the relay itself.

  The card grid and the host badges are the ones the community channel
  overview already uses — a channel list is a channel list, and the reader
  should not be able to tell which container produced it. The sidebar beside
  it is the same one every channel of this host shows, so entering a channel
  changes the pane and leaves the navigation where it was.
-->
<script>
  import { isValidRelayUrl } from '$lib/groups/groups.js';
  import { relayLabel, relayDisplayName, relayIconUrl } from '$lib/groups/relay-directory.js';
  import { useHostChannels } from '$lib/groups/host-channels.svelte.js';
  import { relayBadges } from '$lib/groups/group-badges.js';
  import { announcesNip29 } from '$lib/groups/relay-directory.js';
  import ChannelOverview from '$lib/components/community/channels/ChannelOverview.svelte';
  import HostChannelSidebar from '$lib/components/groups/HostChannelSidebar.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data } = $props();

  const relay = $derived(isValidRelayUrl(data.rawRelay) ? data.rawRelay : null);

  // The three sources, the NIP-42 handling and the merge into rows all live in
  // useHostChannels — shared with the sidebar, so the page and the column
  // beside it can never show different channel lists.
  const getHost = useHostChannels(() => relay);
  const host = $derived(getHost());
  const rows = $derived(host.rows);
  const hostBadges = $derived(relayBadges(host.information));

  // "Nothing here" and "nothing YET" are different sentences, and a relay that
  // simply has not answered must never render as an empty host.
  const settling = $derived(host.loading && rows.length === 0);
  // Measured on relay.damus.io: a general-purpose relay carries stray
  // kind:39000s from ordinary users, and pinning `authors` to the key its
  // NIP-11 names filters them out — a correct zero that reads like a broken
  // page unless we say why.
  const notNip29 = $derived(announcesNip29(host.information) === false && rows.length === 0);
</script>

<svelte:head>
  <title>{relay ? relayLabel(relay) : 'Relay'} — edufeed</title>
</svelte:head>

{#if !relay}
  <div class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-invalid">
    {m.relay_directory_invalid()}
  </div>
{:else}
  <div class="flex h-[calc(100vh-4rem)] min-h-0 overflow-hidden">
    <HostChannelSidebar {relay} />
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- A refusal is the relay's own sentence and says more than ours would;
           "sign in" is only right when nobody has tried yet. Both beat a
           spinner that can never end: a gated request emits nothing at all. -->
      {#if host.authRefused && rows.length === 0}
        <p class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-auth-refused">
          {m.relay_directory_auth_refused({ reason: host.authRefused })}
        </p>
      {:else if host.authRequired && rows.length === 0}
        <p class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-auth">
          {m.relay_directory_auth_required()}
        </p>
      {:else if notNip29}
        <p class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-not-nip29">
          {m.relay_directory_not_nip29()}
        </p>
      {:else if settling}
        <p class="p-8 text-center text-sm opacity-70" data-testid="relay-directory-loading">
          {m.relay_directory_loading()}
        </p>
      {:else}
        <ChannelOverview
          {rows}
          {hostBadges}
          title={relayDisplayName(host.information, relay)}
          titleIcon={relayIconUrl(host.information) ?? ''}
          lead={m.relay_directory_lead()}
          empty={m.relay_directory_empty()}
        />
      {/if}
    </div>
  </div>
{/if}
