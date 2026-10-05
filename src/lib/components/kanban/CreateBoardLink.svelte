<!--
  CreateBoardLink — "Create board" CTA. Boards are authored in the external
  Kanban editor, so this opens its root in a new tab. The editor takes no
  community context via URL; sharing to a community happens inside it.
-->
<script>
  import { ExternalLinkIcon } from '$lib/components/icons';
  import { KANBAN_EDITOR_URL } from '$lib/helpers/kanban-editor.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ class_?: string }} */
  let { class_ = 'btn-primary' } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external: kanban editor link -->
<a
  href={KANBAN_EDITOR_URL}
  target="_blank"
  rel="noopener noreferrer"
  class="btn gap-1 btn-sm {class_}"
  title={m.kanban_create_board_title()}
  data-testid="create-board-link"
>
  <ExternalLinkIcon class_="h-4 w-4" />
  {m.kanban_create_board()}
</a>
