<!--
  DiscoverHero — the /discover header: a plain title for logged-in users,
  onboarding messaging (optionally over the deployment's hero image) for
  visitors.
-->
<script>
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ activeUser: any, heroImage?: string }} */
  let { activeUser, heroImage } = $props();
</script>

{#if activeUser}
  <div class="container mx-auto px-4 pt-8">
    <h1 class="text-3xl font-extrabold tracking-tight text-base-content">
      {m.discover_content_title()}
    </h1>
  </div>
{:else if heroImage}
  <div class="relative overflow-hidden py-12 text-primary-content">
    <ImageWithFallback
      src={heroImage}
      alt=""
      size="hero"
      loading="eager"
      fallbackType="banner"
      class="absolute inset-0 h-full w-full object-cover"
    />
    <div class="relative z-10 container mx-auto px-4">
      <div class="mx-auto max-w-3xl rounded-2xl bg-black/20 p-8 text-center backdrop-blur-sm">
        <h1 class="mb-4 text-4xl font-bold text-white md:text-5xl">
          {m.discover_content_title()}
        </h1>
        <p class="text-lg text-white/90">
          {m.discover_content_subtitle()}
        </p>
        <p class="mt-3 text-sm text-white/70">
          <a
            href="https://onboarding.edufeed.org"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 transition-colors hover:text-white/90"
          >
            {m.discover_onboarding_cta()} ↗
          </a>
        </p>
      </div>
    </div>
  </div>
{:else}
  <div class="bg-gradient-to-br from-primary/10 to-secondary/10 py-12">
    <div class="container mx-auto px-4">
      <h1 class="mb-4 text-center text-4xl font-bold text-base-content md:text-5xl">
        {m.discover_content_title()}
      </h1>
      <p class="text-center text-lg text-base-content/70">
        {m.discover_content_subtitle()}
      </p>
      <p class="mt-3 text-center text-sm text-base-content/50">
        <a
          href="https://onboarding.edufeed.org"
          target="_blank"
          rel="noopener noreferrer"
          class="underline underline-offset-2 transition-colors hover:text-base-content/70"
        >
          {m.discover_onboarding_cta()} ↗
        </a>
      </p>
    </div>
  </div>
{/if}
