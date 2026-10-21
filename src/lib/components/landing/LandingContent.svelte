<script>
  // Body of the logged-out landing (design 5b): live showcase from the
  // deployment's showcase lists, panels and the community wall. Mounted by
  // the route only for logged-out visitors, so a logged-in visit to / starts
  // none of these loaders on its way to /c/.
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
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

  // Which content types the deployment offers (DISCOVER_CONTENT_TYPES).
  const types = $derived(runtimeConfig.discover?.contentTypes || []);
  const enabled = $derived({
    learning: isDiscoverTypeEnabled('learning', types),
    events: isDiscoverTypeEnabled('events', types),
    articles: isDiscoverTypeEnabled('articles', types)
  });
  const communitiesEnabled = $derived(isDiscoverTypeEnabled('communities', types));

  const showcase = useLandingShowcase();

  const getAllCommunities = useAllCommunities();
  // Profiles only for communities on the showcase lists (LANDING_SHOWCASE_LISTS).
  const getCommunityProfiles = useProfileMap(() => {
    const allowed = showcase.sources();
    return getAllCommunities()
      .map((c) => c.pubkey)
      .filter((pk) => allowed.includes(pk));
  });
  const communities = $derived(
    communitiesEnabled
      ? landingCommunities(getAllCommunities(), getCommunityProfiles(), showcase.sources())
      : []
  );
  // useAllCommunitiesLoaded() turns true on the model's first (empty)
  // emission and profiles arrive later still, so the wall keeps its skeleton
  // until a named community shows up or 5 s have passed.
  let communitiesTimedOut = $state(false);
  $effect(() => {
    const timer = setTimeout(() => (communitiesTimedOut = true), 5_000);
    return () => clearTimeout(timer);
  });
  const communitiesSettled = $derived(
    communities.length > 0 ||
      communitiesTimedOut ||
      (showcase.sourcesResolved() && showcase.sources().length === 0)
  );

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
