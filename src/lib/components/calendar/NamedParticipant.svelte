<!--
  NamedParticipant - Row for a calendar participant who has no npub
  (app-specific "participant" tag). Mirrors the ProfileCard layout used for
  p-tag participants: initial avatar + name, no link.
-->

<script>
  /** @type {{name: string, class?: string}} */
  let { name, class: className = '' } = $props();
</script>

<div class="flex items-center gap-3 {className}" data-testid="named-participant">
  <div
    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-300 text-base font-medium text-base-content/70"
    aria-hidden="true"
  >
    {name.charAt(0).toUpperCase()}
  </div>
  <span class="min-w-0 truncate font-medium">{name}</span>
</div>
