<!--
  LandingFooter — the pre-login footer of the landing page: user guide
  (HELP_URL, hidden when a deployment sets it to `none`) and imprint.
  Logged-in users reach both through the account menu instead.
-->
<script>
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { helpLinkAttrs } from '$lib/helpers/help-link.js';

  const helpLink = $derived(helpLinkAttrs(runtimeConfig.help?.url));
</script>

<footer class="border-t border-base-300 bg-base-200">
  <nav
    class="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-base-content/70"
    aria-label={m.landing_footer_aria()}
  >
    {#if helpLink}
      <a {...helpLink} class="link link-hover" data-testid="landing-help-link">
        {m.navbar_help()}
      </a>
    {/if}
    <a href={resolve('/imprint')} class="link link-hover" data-testid="landing-imprint-link">
      {m.navbar_imprint()}
    </a>
  </nav>
</footer>
