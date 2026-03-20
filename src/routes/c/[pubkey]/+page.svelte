<script>
  import { page } from '$app/stores';
  import { replaceState } from '$app/navigation';
  import MainContentArea from '$lib/components/community/layout/MainContentArea.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();

  // selectedContentType is driven by the layout via $page.data.contentView or ?view= param
  let selectedContentType = $derived(
    $page.data.contentView || $page.url.searchParams.get('view') || 'home'
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
      replaceState(url, {});
    }
  }
</script>

<MainContentArea
  selectedCommunityId={data.pubkey}
  {selectedContentType}
  onKindNavigation={handleKindNavigation}
/>
