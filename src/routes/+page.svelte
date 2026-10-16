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
  import { useAllCommunities } from '$lib/stores/all-communities.svelte.js';
  import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
  import { heroPending, landingCommunities, panelState } from '$lib/helpers/landing-showcase.js';
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

  const getAllCommunities = useAllCommunities();
  const getCommunityProfiles = useProfileMap(() => getAllCommunities().map((c) => c.pubkey));
  const communities = $derived(
    communitiesEnabled ? landingCommunities(getAllCommunities(), getCommunityProfiles()) : []
  );
  // useAllCommunitiesLoaded() turns true on the model's first (empty)
  // emission and profiles arrive later still, so the wall keeps its skeleton
  // until a named community shows up or 5 s have passed.
  let communitiesTimedOut = $state(false);
  $effect(() => {
    const timer = setTimeout(() => (communitiesTimedOut = true), 5_000);
    return () => clearTimeout(timer);
  });
  const communitiesSettled = $derived(communities.length > 0 || communitiesTimedOut);

  // Other people's content: their kind 5s must reach the store, or a deleted
  // item (a material, an event, a whole community) keeps showing from a stale
  // local copy.
  useAuthorDeletions(() => [...showcase.authors(), ...communities.map((c) => c.pubkey)]);

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
  pending={heroPending(
    { ...enabled, communities: communitiesEnabled },
    {
      learning: showcase.settled('learning'),
      events: showcase.settled('events'),
      articles: showcase.settled('articles'),
      communities: communitiesSettled
    }
  )}
/>
<LandingShowcase
  materials={showcase.materials()}
  events={showcase.events()}
  articles={showcase.articles()}
  {states}
  {enabled}
/>
{#if communitiesEnabled}
  <CommunityWall {communities} loaded={communitiesSettled} />
{/if}
<LandingFooter />
