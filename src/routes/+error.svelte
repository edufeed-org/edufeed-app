<!--
  App-wide error page (404 / 500 …) in the editorial look: beige page,
  paper card with dashed rule, display-type status code.
-->
<script>
  import { page } from '$app/stores';
  import { resolve as _resolve } from '$app/paths';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);

  let is404 = $derived($page.status === 404);
</script>

<svelte:head>
  <title>{$page.status} – {runtimeConfig.appName}</title>
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center px-4 py-16">
  <div class="err-card" data-testid="error-page">
    <p class="err-script">{m.error_page_script()}</p>
    <h1 class="err-code">{$page.status}</h1>
    <h2 class="err-title">
      {is404 ? m.error_page_404_title() : m.error_page_generic_title()}
    </h2>
    <p class="err-text">
      {is404
        ? m.error_page_404_description()
        : $page.error?.message || m.error_page_generic_title()}
    </p>
    <a href={resolve('/')} class="btn btn-primary">{m.error_page_home()}</a>
  </div>
</div>

<style>
  .err-card {
    background: var(--c-paper);
    border: 1.5px dashed var(--c-rule);
    border-radius: 16px;
    padding: 48px 40px;
    max-width: 480px;
    width: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .err-script {
    font-family: var(--font-script);
    font-size: 26px;
    color: var(--c-band);
    margin: 0;
    line-height: 1;
  }
  .err-code {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 72px;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--c-ink);
    margin: 0;
  }
  .err-title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 18px;
    color: var(--c-ink);
    margin: 0;
  }
  .err-text {
    color: var(--c-ink-soft);
    font-size: 14px;
    margin: 0 0 16px;
    max-width: 360px;
  }
</style>
