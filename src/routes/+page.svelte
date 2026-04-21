<script>
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import LandingHero from '$lib/components/landing/LandingHero.svelte';
  import FeatureHighlights from '$lib/components/landing/FeatureHighlights.svelte';
  import CommunityCarousel from '$lib/components/landing/CommunityCarousel.svelte';

  const activeUser = useActiveUser();

  $effect(() => {
    if (browser && activeUser()) {
      goto(resolve('/c/'), { replaceState: true });
    }
  });
</script>

<svelte:head>
  <title>{m.landing_meta_title({ appName: runtimeConfig.appName })}</title>
  <meta name="description" content={m.landing_meta_description()} />
</svelte:head>

<LandingHero />
<FeatureHighlights />
<CommunityCarousel />
