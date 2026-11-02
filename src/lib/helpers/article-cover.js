/**
 * The cover image of a NIP-23 article (kind 30023/30024) as a URL the app can
 * put into an `<img src>` or an og:image.
 *
 * The `image` tag is untrusted network input. Live relays carry bare
 * filenames ("jonny-gios-…-unsplash.jpg"), which a browser resolves against
 * our own origin and 404s on, and Markdown images pasted into the tag
 * ("![image](https://…)"), whose URL is usable. Anything that is not an
 * absolute http(s) URL after that counts as "no cover".
 */
import { getArticleImage } from 'applesauce-common/helpers';

const MARKDOWN_IMAGE = /^!\[[^\]]*\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)$/;

/**
 * @param {string | null | undefined} value raw `image` tag value
 * @returns {string | undefined}
 */
export function toCoverUrl(value) {
  if (!value) return undefined;
  let candidate = value.trim();
  const markdown = MARKDOWN_IMAGE.exec(candidate);
  if (markdown) candidate = markdown[1];
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {import('nostr-tools').NostrEvent | null | undefined} event
 * @returns {string | undefined}
 */
export function getArticleCoverUrl(event) {
  return event ? toCoverUrl(getArticleImage(event)) : undefined;
}
