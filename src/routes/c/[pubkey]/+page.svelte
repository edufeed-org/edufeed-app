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
   * Handle navigation from content type kind number
   * @param {number} kind - The content type kind number
   */
  function handleKindNavigation(kind) {
    const kindMap = /** @type {{ [key: number]: string }} */ ({
      9: 'chat',
      31923: 'calendar'
    });
    const contentType = kindMap[kind];
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
