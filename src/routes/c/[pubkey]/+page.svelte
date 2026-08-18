<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getContext } from 'svelte';
  import MainContentArea from '$lib/components/community/layout/MainContentArea.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();

  // The layout owns the ONE validated, availability-corrected content view
  // (it folds +page.js's contentView, the ?view param AND whether this
  // community actually offers the view — e.g. carried ?view=channels on an
  // area-less community falls back to home). Rendering from $page.data here
  // created a second source of truth that ignored the correction (laoc,
  // 2026-08-18). The data fallback only covers the first paint before the
  // layout context getter registers.
  /** @type {(() => string) | undefined} */
  const getResolvedContentView = getContext('resolvedContentView');
  let selectedContentType = $derived(
    getResolvedContentView?.() ?? ($page.data.contentView || 'home')
  );

  /**
   * Handle navigation from content type kind number or string tab name
   * @param {number|string} kindOrType - Kind number or content type string
   */
  function handleKindNavigation(kindOrType) {
    /** @type {string|undefined} */
    let contentType;
    if (typeof kindOrType === 'string') {
      contentType = kindOrType;
    } else {
      const kindMap = /** @type {{ [key: number]: string }} */ ({
        9: 'chat',
        31923: 'calendar'
      });
      contentType = kindMap[kindOrType];
    }
    if (contentType) {
      // Sync URL query param
      const url = new URL($page.url);
      if (contentType === 'home') {
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('view', contentType);
      }
      goto(url, { replaceState: true, noScroll: true });
    }
  }
</script>

<MainContentArea
  selectedCommunityId={data.pubkey}
  {selectedContentType}
  onKindNavigation={handleKindNavigation}
/>
