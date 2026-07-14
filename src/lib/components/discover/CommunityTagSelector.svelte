<!--
  CommunityTagSelector Component
  Displays popular tags from communities and allows filtering by tags
-->

<script>
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { extractHashtags } from '$lib/helpers/text.js';
  import { getTagValue } from 'applesauce-core/helpers';
  import { TagIcon } from '../icons';
  import * as m from '$lib/paraglide/messages';

  // Props
  let {
    communities = [],
    communityProfiles = new Map(),
    selectedTags = [],
    onTagChange = () => {}
  } = $props();

  /**
   * Get all tag counts from communities
   * @param {import('nostr-tools').Event[]} communities
   * @param {Map<string, any>} communityProfiles
   * @returns {Map<string, number>}
   */
  function getAllTagCounts(communities, communityProfiles) {
    const tagCounts = new SvelteMap();

    communities.forEach((community) => {
      const communityPubkey = getTagValue(community, 'd') || community.pubkey;
      const profile = communityProfiles.get(communityPubkey);

      // Collect tags from multiple sources
      const tagsFromSources = new SvelteSet();

      // 1. From profile 'about' field
      if (profile?.about) {
        extractHashtags(profile.about).forEach((tag) => tagsFromSources.add(tag));
      }

      // 2. From community event content
      if (community.content) {
        extractHashtags(community.content).forEach((tag) => tagsFromSources.add(tag));
      }

      // 3. From 't' tags (if present)
      const explicitTags =
        community.tags?.filter((tag) => tag[0] === 't').map((tag) => tag[1]) || [];
      explicitTags.forEach((tag) => {
        if (tag && tag.trim()) {
          tagsFromSources.add(tag.toLowerCase().trim());
        }
      });

      // Count occurrences across communities
      tagsFromSources.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });

    return tagCounts;
  }

  /**
   * Get tags to display: selected tags + popular tags
   * @param {import('nostr-tools').Event[]} communities
   * @param {Map<string, any>} communityProfiles
   * @param {string[]} selectedTags
   * @param {number} popularLimit
   * @returns {{ tag: string, count: number, isSelected: boolean }[]}
   */
  function getDisplayedTags(communities, communityProfiles, selectedTags, popularLimit = 15) {
    const tagCounts = getAllTagCounts(communities, communityProfiles);

    // Get top N popular tags
    const popularTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, popularLimit)
      .map(([tag, count]) => ({
        tag,
        count,
        isSelected: selectedTags.includes(tag)
      }));

    // Find selected tags that aren't in the popular list
    const popularTagNames = new Set(popularTags.map((t) => t.tag));
    const selectedNotPopular = selectedTags
      .filter((tag) => !popularTagNames.has(tag))
      .map((tag) => ({
        tag,
        count: tagCounts.get(tag) || 0,
        isSelected: true
      }));

    // Combine: selected (not popular) first, then popular tags
    return [...selectedNotPopular, ...popularTags];
  }

  /**
   * Toggle tag selection
   * @param {string} tag
   */
  function toggleTag(tag) {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];

    onTagChange(newTags);
  }

  /**
   * Clear all selected tags
   */
  function clearTags() {
    onTagChange([]);
  }

  // Derived state
  let displayedTags = $derived(getDisplayedTags(communities, communityProfiles, selectedTags));
  let hasActiveTags = $derived(selectedTags.length > 0);
  let hasTags = $derived(displayedTags.length > 0);
</script>

<div class="border-b border-base-300 bg-base-100 px-6 py-4">
  <!-- Header -->
  <div class="mb-3 flex items-center gap-3">
    <TagIcon class="h-4 w-4 text-base-content/70" />
    <span class="font-medium text-base-content">{m.tag_selector_filter_by_tags()}</span>
    {#if hasActiveTags}
      <span class="badge badge-sm badge-primary">{selectedTags.length}</span>
    {/if}
  </div>

  {#if hasTags}
    <!-- Tag buttons grid -->
    <div class="flex flex-wrap gap-2">
      {#each displayedTags as { tag, count, isSelected } (tag)}
        <button
          class="btn gap-1 btn-sm"
          class:btn-primary={isSelected}
          class:btn-ghost={!isSelected}
          onclick={() => toggleTag(tag)}
          title={m.tag_selector_show_communities_with_tag({ tag })}
        >
          <span class="text-xs opacity-70">#</span>{tag}
          <span class="badge badge-sm">{count}</span>
        </button>
      {/each}
    </div>

    <!-- Clear button -->
    {#if hasActiveTags}
      <div class="mt-3 flex items-center gap-3">
        <button class="btn btn-ghost btn-sm" onclick={clearTags}
          >{m.tag_selector_clear_all()}</button
        >
        <p class="text-xs text-base-content/60">
          {selectedTags.length === 1
            ? m.tag_selector_showing_communities_single()
            : m.tag_selector_showing_communities_multiple({ count: selectedTags.length })}
        </p>
      </div>
    {:else}
      <p class="mt-3 text-xs text-base-content/60">
        {m.tag_selector_communities_help()}
      </p>
    {/if}
  {:else}
    <!-- Empty state -->
    <div class="text-center text-sm text-base-content/50">
      <p>{m.tag_selector_no_communities_found()}</p>
    </div>
  {/if}
</div>
