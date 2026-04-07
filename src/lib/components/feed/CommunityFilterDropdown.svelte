<!--
  CommunityFilterDropdown Component
  A grouped dropdown for filtering feed content by community
  
  Options:
  - All: Show all content
  - My Communities: Show content from all joined communities
  - Joined section: Individual joined communities
  - Discover section: Individual non-joined communities
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} CommunityOption
   * @property {string} pubkey - Community pubkey
   * @property {string} name - Display name for the community
   */

  /**
   * @typedef {Object} Props
   * @property {string | null} value - Current filter value: null (all), 'joined', or community pubkey
   * @property {CommunityOption[]} joinedCommunities - Array of joined community options
   * @property {CommunityOption[]} discoverCommunities - Array of non-joined community options
   * @property {(value: string | null) => void} onchange - Callback when filter changes
   * @property {boolean} [disabled=false] - Whether the dropdown is disabled
   */

  /** @type {Props} */
  let {
    value = null,
    joinedCommunities = [],
    discoverCommunities = [],
    onchange,
    disabled = false
  } = $props();

  /**
   * Get display text for current selection
   * Note: Currently unused - kept for future dropdown label display
   * @returns {string}
   */
  function _getDisplayText() {
    if (!value) return 'All';
    if (value === 'joined') return 'My Communities';

    // Find community name
    const joined = joinedCommunities.find((c) => c.pubkey === value);
    if (joined) return joined.name;

    const discover = discoverCommunities.find((c) => c.pubkey === value);
    if (discover) return discover.name;

    return `${value.slice(0, 8)}...`;
  }

  /**
   * Handle selection change
   * @param {Event} e
   */
  function handleChange(e) {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    const newValue = target.value === '' ? null : target.value;
    onchange(newValue);
  }
</script>

<div class="form-control w-full">
  <label for="community-filter" class="label">
    <span class="label-text font-medium">{m.discover_community_label()}</span>
  </label>
  <select
    id="community-filter"
    class="select-bordered select w-full"
    value={value ?? ''}
    onchange={handleChange}
    {disabled}
  >
    <!-- Default options -->
    <option value="">{m.community_filter_all()}</option>
    {#if joinedCommunities.length > 0}
      <option value="joined">{m.community_filter_my()}</option>
    {/if}

    <!-- Joined communities section -->
    {#if joinedCommunities.length > 0}
      <optgroup label={m.community_filter_joined()}>
        {#each joinedCommunities as community (community.pubkey)}
          <option value={community.pubkey}>{community.name}</option>
        {/each}
      </optgroup>
    {/if}

    <!-- Discover communities section -->
    {#if discoverCommunities.length > 0}
      <optgroup label={m.community_filter_discover()}>
        {#each discoverCommunities as community (community.pubkey)}
          <option value={community.pubkey}>{community.name}</option>
        {/each}
      </optgroup>
    {/if}
  </select>
</div>
