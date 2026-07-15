<!--
  Test fixture — wraps NostrContentRenderer in a click-to-navigate host
  (like NoteCard) so tests can assert media clicks don't bubble into it.
-->
<script>
  import NostrContentRenderer from '../../shared/NostrContentRenderer.svelte';

  /** @type {{ event: any, onouterclick: () => void }} */
  let { event, onouterclick } = $props();
</script>

<div role="button" tabindex="0" onclick={onouterclick} onkeydown={() => {}}>
  <NostrContentRenderer {event} />
</div>
