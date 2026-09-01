<script>
  import Icon from '../Icon.svelte';

  // Every other icon in the set takes `class_` and delegates to Icon.svelte;
  // this one used to take a bare `class` and render its own <svg>, so callers
  // following the convention (MetadataCardGrid's `class_="w-7 h-7"`, including
  // its neutral fallback for unknown facets) got an unsized, invisible glyph.
  // Accept both spellings so the existing `class=` call sites keep working.
  let { class: className = '', class_ = className || 'w-5 h-5', title = '' } = $props();
</script>

<Icon {class_} {title}>
  <path
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="2"
    d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"
  />
</Icon>
