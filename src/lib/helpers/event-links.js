/**
 * Split a calendar event's reference links (NIP-52 `r` tags) into the
 * prominent "event website" link and the remaining "further links".
 *
 * Convention (GitHub #7): the FIRST reference is the event's main page
 * (website / registration, later documentation). It is only promoted when it
 * is an http(s) URL; otherwise nothing is promoted and every link stays in the
 * further-links list, as before.
 *
 * Tag values are untrusted: blanks and non-strings are dropped and repeats
 * removed (the lists feed keyed {#each} blocks).
 *
 * Pure and dependency-free.
 */

/**
 * @param {unknown} value
 * @returns {URL | null}
 */
function parseHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown[] | null | undefined} references
 * @returns {{ primary: { url: string, host: string } | null, others: string[] }}
 */
export function splitEventLinks(references) {
  /** @type {string[]} */
  const links = [];
  for (const ref of references ?? []) {
    if (typeof ref !== 'string') continue;
    const trimmed = ref.trim();
    if (trimmed && !links.includes(trimmed)) links.push(trimmed);
  }

  const first = parseHttpUrl(links[0]);
  if (!first) return { primary: null, others: links };

  return {
    primary: { url: links[0], host: first.hostname.replace(/^www\./, '') },
    others: links.slice(1)
  };
}
