<script>
  import * as m from '$lib/paraglide/messages';
  import { showToast } from '$lib/helpers/toast.js';
  import {
    BookmarkShareIcon,
    LinkIcon,
    LinkedinIcon,
    FacebookIcon,
    TwitterXIcon,
    WhatsappIcon,
    EnvelopeIcon
  } from '$lib/components/icons';

  /** @type {{ title: string }} */
  let { title } = $props();

  let menuOpen = $state(false);
  /** @type {HTMLDetailsElement | undefined} */
  let menuEl = $state();

  // Close the dropdown when clicking outside it (<details> doesn't do this natively).
  $effect(() => {
    if (!menuOpen) return;
    /** @param {MouseEvent} e */
    const onPointerDown = (e) => {
      if (menuEl && !menuEl.contains(/** @type {Node} */ (e.target))) {
        menuOpen = false;
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });

  function currentUrl() {
    return typeof window !== 'undefined' ? window.location.href : '';
  }

  /**
   * Open the share UI. Uses the native share sheet when available (mobile),
   * otherwise toggles the external-network dropdown.
   */
  async function share() {
    const url = currentUrl();
    if (!url) return;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        // user cancelled share sheet — ignore
      }
      return;
    }
    menuOpen = !menuOpen;
  }

  /**
   * Open an external social network share link in a new tab.
   * @param {'linkedin'|'facebook'|'x'|'email'|'whatsapp'} network
   */
  function shareTo(network) {
    const rawUrl = currentUrl();
    if (!rawUrl) return;
    const url = encodeURIComponent(rawUrl);
    const text = encodeURIComponent(title);
    /** @type {Record<string, string>} */
    const targets = {
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      x: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
      email: `mailto:?subject=${text}&body=${url}`,
      whatsapp: `https://wa.me/?text=${text}%20${url}`
    };
    const target = targets[network];
    if (!target) return;
    if (network === 'email') {
      window.location.href = target;
    } else {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
    menuOpen = false;
  }

  async function copyLink() {
    const url = currentUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast(m.bookmark_detail_share_copied(), 'success');
    } catch {
      // clipboard unavailable — ignore
    }
    menuOpen = false;
  }
</script>

<details bind:this={menuEl} class="dropdown dropdown-end w-full" bind:open={menuOpen}>
  <summary
    onclick={(e) => {
      // On mobile, prefer the native share sheet over the dropdown.
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        e.preventDefault();
        share();
      }
    }}
    class="inline-flex w-full cursor-pointer items-center gap-2 rounded-full border border-base-300 px-3 py-2 text-sm font-semibold text-base-content/70 transition-colors hover:text-base-content"
  >
    <BookmarkShareIcon class_="h-4 w-4" />
    {m.bookmark_detail_share()}
  </summary>
  <ul class="dropdown-content menu z-20 mt-1 w-56 rounded-box bg-base-100 p-2 shadow-lg">
    <li>
      <button type="button" onclick={copyLink}>
        <LinkIcon class_="h-4 w-4" />
        {m.bookmark_detail_copy_link()}
      </button>
    </li>
    <div class="divider my-0"></div>
    <li class="menu-title px-2 py-1 text-[11px] tracking-wide uppercase">
      {m.bookmark_detail_share_to()}
    </li>
    <li>
      <button type="button" onclick={() => shareTo('linkedin')}>
        <LinkedinIcon class_="h-4 w-4" />
        {m.bookmark_detail_share_linkedin()}
      </button>
    </li>
    <li>
      <button type="button" onclick={() => shareTo('facebook')}>
        <FacebookIcon class_="h-4 w-4" />
        {m.bookmark_detail_share_facebook()}
      </button>
    </li>
    <li>
      <button type="button" onclick={() => shareTo('x')}>
        <TwitterXIcon class_="h-4 w-4" />
        {m.bookmark_detail_share_x()}
      </button>
    </li>
    <li>
      <button type="button" onclick={() => shareTo('whatsapp')}>
        <WhatsappIcon class_="h-4 w-4" />
        {m.bookmark_detail_share_whatsapp()}
      </button>
    </li>
    <li>
      <button type="button" onclick={() => shareTo('email')}>
        <EnvelopeIcon class_="h-4 w-4" />
        {m.bookmark_detail_share_email()}
      </button>
    </li>
  </ul>
</details>
