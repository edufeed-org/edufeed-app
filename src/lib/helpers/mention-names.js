/**
 * Svelte action: resolve profile names for mention links in rendered HTML.
 *
 * `preprocessNostrMentions` turns a bare `nostr:npub…` in markdown/djot into
 * a link whose text is the truncated npub. This action watches the rendered
 * subtree for `<a href="/npub1…">` / `<a href="/nprofile1…">` whose text is
 * still that generated label, loads the profile once per pubkey and rewrites
 * the text to `@Name`. Author-written link text (`[Alice](nostr:npub…)`) is
 * left alone. Works on any host that sets innerHTML (MarkdownRenderer,
 * HighlightOverlay) — a MutationObserver re-wires after each replacement.
 */
import { nip19 } from 'nostr-tools';
import { subscribeProfile } from '$lib/stores/profile-subscription.js';
import { getUserDisplayName } from '$lib/helpers/message-utils.js';

const WIRED = 'mentionNameWired';

/**
 * @param {string} href
 * @returns {{ pubkey: string, bech32: string } | null}
 */
function profileFromHref(href) {
  const bech32 = href.startsWith('/') ? href.slice(1) : href;
  if (!/^(npub|nprofile)1/.test(bech32)) return null;
  try {
    const decoded = nip19.decode(bech32);
    if (decoded.type === 'npub') return { pubkey: decoded.data, bech32 };
    if (decoded.type === 'nprofile') return { pubkey: decoded.data.pubkey, bech32 };
  } catch {
    /* not a pointer */
  }
  return null;
}

/**
 * The label preprocessNostrMentions generates for an id (see markdownNostr.js).
 * @param {string} bech32
 */
function generatedLabel(bech32) {
  return bech32.length > 14 ? `${bech32.slice(0, 10)}…${bech32.slice(-3)}` : bech32;
}

/**
 * @param {HTMLElement} node
 * @returns {{ destroy: () => void }}
 */
export function mentionNames(node) {
  /** @type {Map<string, { unsubscribe: () => void }>} */
  const subscriptions = new Map();
  /** @type {Map<string, HTMLAnchorElement[]>} */
  const anchorsByPubkey = new Map();
  /** last known label per pubkey — hosts that re-render (HighlightOverlay on
   *  every highlights emission) get it applied on the next wire() without a
   *  second profile callback */
  /** @type {Map<string, string>} */
  const labels = new Map();

  /** @param {string} pubkey @param {string} label */
  function applyLabel(pubkey, label) {
    // drop anchors a host re-render has replaced (they left the subtree)
    const anchors = (anchorsByPubkey.get(pubkey) ?? []).filter((a) => node.contains(a));
    anchorsByPubkey.set(pubkey, anchors);
    for (const anchor of anchors) anchor.textContent = label;
  }

  function wire() {
    for (const el of node.querySelectorAll('a[href^="/npub1"], a[href^="/nprofile1"]')) {
      const a = /** @type {HTMLAnchorElement} */ (el);
      if (a.dataset[WIRED]) continue;
      a.dataset[WIRED] = 'true';
      const ref = profileFromHref(a.getAttribute('href') ?? '');
      if (!ref) continue;
      const text = a.textContent ?? '';
      if (text !== generatedLabel(ref.bech32) && text !== `nostr:${ref.bech32}`) continue;
      const list = anchorsByPubkey.get(ref.pubkey) ?? [];
      list.push(a);
      anchorsByPubkey.set(ref.pubkey, list);
      const known = labels.get(ref.pubkey);
      if (known) a.textContent = known;
      if (subscriptions.has(ref.pubkey)) continue;
      subscriptions.set(
        ref.pubkey,
        subscribeProfile(ref.pubkey, (profile) => {
          if (!profile?.display_name && !profile?.name) return;
          const label = `@${getUserDisplayName(ref.pubkey, profile)}`;
          labels.set(ref.pubkey, label);
          applyLabel(ref.pubkey, label);
        })
      );
    }
  }

  wire();
  const observer = new MutationObserver(() => wire());
  observer.observe(node, { childList: true, subtree: true });

  return {
    destroy() {
      observer.disconnect();
      for (const sub of subscriptions.values()) sub.unsubscribe();
      subscriptions.clear();
      anchorsByPubkey.clear();
      labels.clear();
    }
  };
}
