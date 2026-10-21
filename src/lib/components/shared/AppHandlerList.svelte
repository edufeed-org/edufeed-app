<!--
  AppHandlerList — "Open in another app" links for an event the app has no
  dedicated view for (NIP-89).

  Handlers come from loaders/app-handlers.js: kind 31989 recommendations by
  the user and their follows first, then a direct kind 31990 query. Each row
  links to the handler's `web` URL template with the event's nevent/naddr
  substituted. Renders nothing while the feature is off (no handler relays).
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { nip19 } from 'nostr-tools';
  import { getSeenRelays, getDisplayName } from 'applesauce-core/helpers';
  import { loadAppHandlers } from '$lib/loaders/app-handlers.js';
  import { resolveHandlerUrl } from '$lib/helpers/nip89.js';
  import { getAppHandlerRelays, getAppManagedRelays } from '$lib/helpers/relay-helper.js';
  import { prioritizeRelayHints } from '$lib/helpers/relayHints.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ImageWithFallback from './ImageWithFallback.svelte';
  import { ExternalLinkIcon } from '$lib/components/icons';

  /** @type {{ event: any }} */
  let { event } = $props();

  const getActiveUser = useActiveUser();

  /** @type {import('$lib/loaders/app-handlers.js').DiscoveredHandler[]} */
  let handlers = $state.raw([]);
  let loading = $state(false);
  const enabled = $derived(getAppHandlerRelays().length > 0);

  // NIP-19 entity the handler URL gets: naddr for addressable kinds, nevent
  // otherwise — with the relays we actually saw the event on as hints.
  const entity = $derived.by(() => {
    if (!event?.id) return null;
    const relays = prioritizeRelayHints(getSeenRelays(event), getAppManagedRelays());
    try {
      if (event.kind >= 30000 && event.kind < 40000) {
        const identifier = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? '';
        return {
          type: /** @type {const} */ ('naddr'),
          bech32: nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier, relays })
        };
      }
      return {
        type: /** @type {const} */ ('nevent'),
        bech32: nip19.neventEncode({ id: event.id, relays })
      };
    } catch {
      return null;
    }
  });

  // Handlers without inline metadata fall back to their pubkey's kind 0.
  const getProfiles = useProfileMap(() =>
    handlers.filter((h) => !h.name || !h.picture).map((h) => h.pubkey)
  );

  $effect(() => {
    const kind = event?.kind;
    const user = getActiveUser()?.pubkey;
    const follows = contactsStore.contacts;
    if (!enabled || !Number.isInteger(kind)) {
      handlers = [];
      return;
    }
    const authors = [...new Set([user, ...follows].filter(Boolean))];
    let cancelled = false;
    loading = true;
    loadAppHandlers(kind, { authors }).then((found) => {
      if (cancelled) return;
      handlers = found;
      loading = false;
    });
    return () => {
      cancelled = true;
    };
  });

  const rows = $derived.by(() => {
    if (!entity) return [];
    const profiles = getProfiles();
    return handlers.flatMap((h) => {
      const url = resolveHandlerUrl(h, entity);
      if (!url) return [];
      const profile = profiles.get(h.pubkey);
      return [
        {
          key: h.address,
          url,
          name: h.name ?? (profile ? getDisplayName(profile) : null) ?? h.identifier,
          picture: h.picture ?? profile?.picture ?? null,
          about: h.about ?? profile?.about ?? null,
          recommended: h.recommended
        }
      ];
    });
  });
</script>

{#if enabled && entity}
  <section class="app-handlers rounded-box border border-base-300 bg-base-100 p-4">
    <h2 class="font-semibold">{m.app_handlers_title()}</h2>
    {#if loading && rows.length === 0}
      <p class="mt-2 flex items-center gap-2 text-sm text-base-content/60">
        <span class="loading loading-xs loading-spinner"></span>
        {m.app_handlers_loading()}
      </p>
    {:else if rows.length === 0}
      <p class="mt-2 text-sm text-base-content/60">{m.app_handlers_none()}</p>
    {:else}
      <p class="mt-1 text-sm text-base-content/60">{m.app_handlers_intro()}</p>
      <ul class="mt-3 divide-y divide-base-300">
        {#each rows as row (row.key)}
          <li class="flex items-center gap-3 py-2">
            <div class="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-base-200">
              {#if row.picture}
                <ImageWithFallback src={row.picture} alt="" class="h-full w-full object-cover" />
              {/if}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate font-medium">{row.name}</span>
                {#if row.recommended}
                  <span class="badge badge-outline badge-sm badge-primary">
                    {m.app_handlers_recommended()}
                  </span>
                {/if}
              </div>
              {#if row.about}
                <p class="line-clamp-1 text-sm text-base-content/60">{row.about}</p>
              {/if}
            </div>
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn gap-1 btn-sm btn-primary"
              title={m.app_handlers_external_hint()}
            >
              {m.app_handlers_open()}
              <ExternalLinkIcon class_="w-4 h-4" />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}
