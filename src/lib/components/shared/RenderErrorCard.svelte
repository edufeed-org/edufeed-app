<!--
  RenderErrorCard — fallback UI for the route-level <svelte:boundary> in
  +layout.svelte. Shown when a page throws during render (e.g. a malformed
  Nostr event tripping each_key_duplicate) so the app shell stays usable.

  Auto-resets on navigation: a failed boundary otherwise stays failed, which
  would leave every subsequent page stuck on this card.

  "Report error" opens the (lazily loaded) ReportIssueModal prefilled with
  the error message, a trimmed stack, the route, app version and user agent
  — never event content, keys or account data. Logged-in only: reports are
  public NIP-34 issues signed by the user.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { afterNavigate } from '$app/navigation';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { collectReportContext } from '$lib/helpers/issue-report.js';

  /** @type {{ error?: unknown, onretry?: () => void }} */
  let { error = undefined, onretry = undefined } = $props();

  const getActiveUser = useActiveUser();
  const canReport = $derived(!!getActiveUser()?.signer);

  const detail = $derived(error instanceof Error ? error.message : String(error ?? ''));

  afterNavigate(() => onretry?.());

  function openReport() {
    if (!canReport) return;
    const context = collectReportContext({
      error,
      appName: runtimeConfig.appName || undefined
    });
    modalStore.openModal('reportIssue', {
      prefill: {
        type: 'bug',
        subject: m.report_issue_error_subject({ message: detail.slice(0, 100) }),
        description: '',
        context
      }
    });
  }
</script>

<div class="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
  <div class="text-4xl" aria-hidden="true">⚠️</div>
  <h2 class="text-lg font-semibold">{m.render_error_title()}</h2>
  <p class="text-sm text-base-content/70">{m.render_error_description()}</p>
  {#if detail}
    <code class="max-w-full overflow-x-auto rounded bg-base-200 px-2 py-1 text-xs break-all">
      {detail}
    </code>
  {/if}
  <div class="flex flex-wrap justify-center gap-2">
    <button type="button" class="btn btn-sm btn-primary" onclick={() => onretry?.()}>
      {m.render_error_retry()}
    </button>
    <button
      type="button"
      class="btn btn-outline btn-sm"
      data-testid="render-error-report"
      disabled={!canReport}
      title={canReport ? undefined : m.report_issue_login_required()}
      onclick={openReport}
    >
      {m.render_error_report()}
    </button>
  </div>
  {#if !canReport}
    <p class="text-xs text-base-content/50" data-testid="render-error-report-hint">
      {m.report_issue_login_required()}
    </p>
  {/if}
</div>
