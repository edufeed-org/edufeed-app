<!--
  CreatorAvatarStack Component
  Overlapping avatars for a resource's creators: real profile pictures for
  creators with a Nostr identity, dashed initials (MetadataAvatar) for
  metadata-only names. Shows at most `max` circles; beyond that the last
  slot becomes a "+N" overflow circle.
-->

<script>
  import ProfileAvatar from './ProfileAvatar.svelte';
  import MetadataAvatar from './MetadataAvatar.svelte';

  /**
   * @typedef {import('$lib/helpers/educational/resourceAttribution.js').DisplayCreator} DisplayCreator
   */

  /**
   * @typedef {Object} Props
   * @property {DisplayCreator[]} [creators]
   * @property {number} [max] - Maximum circles including the overflow circle
   * @property {'xs' | 'md'} [size]
   */

  /** @type {Props} */
  let { creators = [], max = 3, size = 'md' } = $props();

  const visible = $derived(creators.length > max ? creators.slice(0, max - 1) : creators);
  const overflow = $derived(creators.length - visible.length);

  const sizeClasses = {
    xs: 'h-6 w-6 text-[9px]',
    md: 'h-10 w-10 text-sm'
  };
  const overlapClass = $derived(size === 'xs' ? '-space-x-1.5' : '-space-x-3');
</script>

<div class="flex {overlapClass}" data-testid="creator-avatar-stack">
  {#each visible as creator, i (creator.pubkey ?? `${creator.name}:${i}`)}
    <span class="rounded-full bg-base-100 ring-2 ring-base-100">
      {#if creator.pubkey}
        <ProfileAvatar
          pubkey={creator.pubkey}
          {size}
          linkToProfile
          showHoverCard
          fallbackType="robohash"
        />
      {:else}
        <MetadataAvatar name={creator.name} {size} />
      {/if}
    </span>
  {/each}
  {#if overflow > 0}
    <span
      class="grid {sizeClasses[
        size
      ]} flex-shrink-0 place-items-center rounded-full bg-base-200 font-semibold text-base-content/70 ring-2 ring-base-100"
      data-testid="creator-overflow"
    >
      +{overflow}
    </span>
  {/if}
</div>
