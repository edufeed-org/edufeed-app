<!-- Stands in for the real GroupAppStage (which would otherwise pull in
     createGroupSync's relay backfill/subscription plumbing and
     WebxdcPlayer's sandbox iframe machinery — both irrelevant to GroupChat's
     OWN wiring under test here). Exposes just enough surface for a test to
     drive the onShareText → export-dialog → create-route handoff GroupChat
     owns: a button that calls onShareText with a fixed file, matching the
     shape GroupAppStage's real handleShareFile hands upward. -->
<script>
  let { session, onShareText, onClose } = $props();
</script>

<div data-testid="group-app-stage-stub">
  <span>{session.app.name}</span>
  <button
    type="button"
    data-testid="stage-stub-share"
    onclick={() => onShareText({ name: 'Sitzung.txt', plainText: '# Exported notes' })}
  >
    share
  </button>
  <button type="button" data-testid="stage-stub-close" onclick={onClose}>close</button>
</div>
