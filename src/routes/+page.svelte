<script>
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useLandingShowcase } from '$lib/stores/landing-showcase.svelte.js';
  import { useAuthorDeletions } from '$lib/stores/author-deletions.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import {
    useAllCommunities,
    useAllCommunitiesLoaded
  } from '$lib/stores/all-communities.svelte.js';
  import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
  import { landingCommunities, panelState } from '$lib/helpers/landing-showcase.js';
  import LandingHero from '$lib/components/landing/LandingHero.svelte';
  import LandingShowcase from '$lib/components/landing/LandingShowcase.svelte';
  import CommunityWall from '$lib/components/landing/CommunityWall.svelte';
  import LandingFooter from '$lib/components/landing/LandingFooter.svelte';

  const activeUser = useActiveUser();

  $effect(() => {
    if (browser && activeUser()) {
      goto(resolve('/c/'), { replaceState: true });
    }
  });

  // Landing design 5b (Claude Design "Landing Round 3"): live content from
  // the cheap discover feeds, gated by the deployment's discover types.
  const types = $derived(runtimeConfig.discover?.contentTypes || []);
  const enabled = $derived({
    learning: isDiscoverTypeEnabled('learning', types),
    events: isDiscoverTypeEnabled('events', types),
    articles: isDiscoverTypeEnabled('articles', types)
  });
  const communitiesEnabled = $derived(isDiscoverTypeEnabled('communities', types));

  const showcase = useLandingShowcase();
  // Other people's content: their kind 5s must reach the store, or a deleted
  // item keeps showing from a stale local copy.
  useAuthorDeletions(() => showcase.authors());

  const getAllCommunities = useAllCommunities();
  const getCommunitiesLoaded = useAllCommunitiesLoaded();
  const getCommunityProfiles = useProfileMap(() => getAllCommunities().map((c) => c.pubkey));
  const communities = $derived(
    communitiesEnabled ? landingCommunities(getAllCommunities(), getCommunityProfiles()) : []
  );

  const states = $derived({
    learning: panelState(showcase.materials(), showcase.settled('learning')),
    events: panelState(showcase.events(), showcase.settled('events')),
    articles: panelState(showcase.articles(), showcase.settled('articles'))
  });
</script>

<svelte:head>
  <title>{m.landing_meta_title({ appName: runtimeConfig.appName })}</title>
  <meta name="description" content={m.landing_meta_description()} />
</svelte:head>

<LandingHero
  heroMaterial={showcase.heroMaterial()}
  nextEvent={showcase.events()[0] ?? null}
  article={showcase.articles()[0] ?? null}
  community={communities[0] ?? null}
/>
<LandingShowcase
  materials={showcase.materials()}
  events={showcase.events()}
  articles={showcase.articles()}
  {states}
  {enabled}
/>
{#if communitiesEnabled}
  <CommunityWall {communities} loaded={getCommunitiesLoaded()} />
{/if}
<LandingFooter />
