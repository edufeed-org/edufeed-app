<!--
  Mirrors how the settings editor, NIP51ListDetailView and DashboardLists all
  render a parsed kind-10002: a keyed {#each} whose key is the relay URL.
  Exists so a test can prove the parser's output is actually safe to key on,
  not just that it looks deduped.
-->
<script>
  /** @type {{ entries: Array<{url: string, read: boolean, write: boolean}> }} */
  let { entries } = $props();
</script>

<ul>
  {#each entries as entry (entry.url)}
    <li data-testid="relay-row">{entry.url} {entry.read ? 'R' : ''}{entry.write ? 'W' : ''}</li>
  {/each}
</ul>
