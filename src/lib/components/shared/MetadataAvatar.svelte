<!--
  MetadataAvatar Component
  Dashed initials circle for authors that exist only as metadata name strings
  (no Nostr profile behind them) — e.g. AMB creator:* runs on indexed resources.
  The dashed outline deliberately distinguishes it from real profile avatars.
-->

<script>
  import { creatorInitials } from '$lib/helpers/educational/resourceAttribution.js';

  /**
   * @typedef {Object} Props
   * @property {string} [name] - Creator name from metadata
   * @property {'xs' | 'md'} [size] - Avatar size (matches ProfileAvatar dims)
   */

  /** @type {Props} */
  let { name = '', size = 'md' } = $props();

  const sizeClasses = {
    xs: 'h-6 w-6 text-[9px]',
    md: 'h-10 w-10 text-sm'
  };
</script>

<div
  class="grid {sizeClasses[
    size
  ]} flex-shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-secondary bg-transparent font-semibold text-secondary"
  data-testid="metadata-avatar"
  title={name}
  aria-hidden="true"
>
  {creatorInitials(name)}
</div>
