<!--
  EnrichmentStatusBanner: persistent strip across wizard Steps 3+ that signals
  what the AI metadata helper is currently doing. The wizard owns
  `enrichmentStatus` ('idle' | 'pending' | 'success' | 'error' | 'skipped-amb');
  this component renders the appropriate flavor.

  Pending has no dismiss — the user shouldn't be able to opt out of the signal
  while the call is in flight. Other terminal states get a ✗ button so the
  banner can be cleared once the user has noticed it.
-->
<script>
  /**
   * @type {{
   *   status: 'idle' | 'pending' | 'success' | 'error' | 'skipped-amb',
   *   ondismiss?: () => void
   * }}
   */
  let { status, ondismiss } = $props();
</script>

{#if status === 'pending'}
  <div role="status" class="my-3 alert alert-info" aria-live="polite">
    <span class="loading loading-sm loading-spinner"></span>
    <div>
      <div class="font-medium">✨ KI ergänzt gleich Vorschläge — kurz Geduld …</div>
      <div class="text-sm opacity-80">
        Du kannst weiterklicken; bitte warte mit dem Tippen, damit die Vorschläge nicht
        überschrieben werden.
      </div>
    </div>
  </div>
{:else if status === 'success'}
  <div role="status" class="my-3 alert alert-success" aria-live="polite">
    <span aria-hidden="true">✨</span>
    <span>Vorschläge bereit — bitte prüfen und ggf. anpassen.</span>
    {#if ondismiss}
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        onclick={ondismiss}
        aria-label="Hinweis schließen"
      >
        ✗
      </button>
    {/if}
  </div>
{:else if status === 'error'}
  <div role="status" class="my-3 alert alert-warning" aria-live="polite">
    <span>KI konnte keine Vorschläge erstellen — bitte manuell ausfüllen.</span>
    {#if ondismiss}
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        onclick={ondismiss}
        aria-label="Hinweis schließen"
      >
        ✗
      </button>
    {/if}
  </div>
{:else if status === 'skipped-amb'}
  <div role="status" class="my-3 alert alert-info" aria-live="polite">
    <span>✓ AMB-Metadaten in der Seite gefunden — KI nicht nötig.</span>
    {#if ondismiss}
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        onclick={ondismiss}
        aria-label="Hinweis schließen"
      >
        ✗
      </button>
    {/if}
  </div>
{/if}
