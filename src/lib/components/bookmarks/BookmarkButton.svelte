<!--
  BookmarkButton — Toggle personal bookmark (NIP-51 kind 10003) for an event.
-->
<script>
  import { BookmarkIcon } from '$lib/components/icons';
  import { isBookmarked, bookmark, unbookmark } from '$lib/stores/personal-bookmarks.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ event: import('nostr-tools').NostrEvent }} */
  let { event } = $props();

  let isSaving = $state(false);
  let active = $derived(isBookmarked(event));

  async function toggle() {
    if (!manager.active) {
      showToast(m.bookmark_toast_login_required(), 'warning');
      return;
    }
    if (isSaving) return;

    isSaving = true;
    try {
      if (active) {
        await unbookmark(event);
        showToast(m.bookmark_toast_removed(), 'info');
      } else {
        await bookmark(event);
        showToast(m.bookmark_toast_saved(), 'success');
      }
    } catch (err) {
      console.error('BookmarkButton: action failed', err);
      showToast(m.bookmark_toast_error(), 'error');
    } finally {
      isSaving = false;
    }
  }
</script>

<button
  class="btn btn-ghost btn-sm {active ? 'text-primary' : ''}"
  onclick={toggle}
  disabled={isSaving}
  title={active ? m.bookmark_toast_removed() : m.bookmark_toast_saved()}
>
  {#if isSaving}
    <span class="loading loading-xs loading-spinner"></span>
  {:else}
    <BookmarkIcon class_="w-4 h-4" filled={active} />
  {/if}
</button>
