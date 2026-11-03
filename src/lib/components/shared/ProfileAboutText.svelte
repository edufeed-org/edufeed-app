<!--
  ProfileAboutText — a profile's kind-0 `about` (people and communities).
  Plain text, never markdown: line breaks are kept, while URLs, nostr:
  mentions (NIP-27), custom emojis (NIP-30, from the profile event's emoji
  tags) and hashtags become links. Rendered through the same
  NostrContentRenderer as notes.
-->
<script>
  import { resolve } from '$app/paths';
  import { Tokens } from 'applesauce-core/helpers';
  import NostrContentRenderer from './NostrContentRenderer.svelte';

  /**
   * @type {{
   *   about: string,
   *   tags?: string[][],
   *   class?: string
   * }}
   */
  let { about, tags = [], class: className = '' } = $props();

  // The parser only links hashtags that have a matching `t` tag (as in a
  // note). A kind 0 carries none, so every hashtag in the text gets one here,
  // matched with the parser's own expression.
  let hashtagTags = $derived(
    [...(about ?? '').matchAll(Tokens.hashtag)].map((match) => ['t', match[1].toLowerCase()])
  );

  // A synthetic event, so the renderer's parser (and its emoji/imeta lookups)
  // see the about text with the profile's tags. Rebuilt when the text changes,
  // so the parser's per-object cache never serves a stale tree.
  let aboutEvent = $derived({
    id: '',
    kind: 0,
    pubkey: '',
    created_at: 0,
    content: about ?? '',
    tags: [...tags, ...hashtagTags],
    sig: ''
  });

  /** @param {string} tag */
  function hashtagHref(tag) {
    return resolve(`/discover?tags=${encodeURIComponent(tag)}`);
  }
</script>

<NostrContentRenderer event={aboutEvent} class={className} {hashtagHref} embeds={false} />
