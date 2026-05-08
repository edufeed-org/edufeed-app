<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import MainContentArea from '$lib/components/community/layout/MainContentArea.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();

  // selectedContentType is driven by +page.js, which validates ?view= against the
  // set of community content types. Do NOT fall back to the raw searchParams value —
  // that bypasses validation and lets foreign params (e.g. ?view=list from /calendar,
  // preserved by buildCommunityPath on cross-route navigation) through, which makes
  // MainContentArea render no view at all.
  let selectedContentType = $derived($page.data.contentView || 'home');

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
