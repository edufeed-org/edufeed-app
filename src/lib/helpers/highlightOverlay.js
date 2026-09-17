import { getHighlightText, getHighlightContext } from 'applesauce-common/helpers';
import { getDisplayName } from 'applesauce-core/helpers';

/**
 * Normalize whitespace in text for matching.
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Find highlight positions in article text.
 * @param {string} articleText - Plain text from Readability's textContent
 * @param {any[]} highlights - Kind 9802 events
 * @returns {{ matched: Array<{start: number, end: number, events: any[]}>, unmatched: any[] }}
 */
export function matchHighlights(articleText, highlights) {
  if (!articleText || !highlights?.length) {
    return { matched: [], unmatched: highlights || [] };
  }

  const normalizedArticle = normalizeWhitespace(articleText);
  /** @type {Array<{start: number, end: number, events: any[]}>} */
  const rawMatches = [];
  /** @type {any[]} */
  const unmatched = [];

  for (const event of highlights) {
    const text = getHighlightText(event);
    if (!text) {
      unmatched.push(event);
      continue;
    }

    const normalizedText = normalizeWhitespace(text);
    if (!normalizedText) {
      unmatched.push(event);
      continue;
    }

    // Find all occurrences
    /** @type {number[]} */
    const positions = [];
    let searchFrom = 0;
    while (true) {
      const idx = normalizedArticle.indexOf(normalizedText, searchFrom);
      if (idx === -1) break;
      positions.push(idx);
      searchFrom = idx + 1;
    }

    if (positions.length === 0) {
      unmatched.push(event);
      continue;
    }

    let bestPos = positions[0];

    // If multiple matches and context exists, disambiguate
    if (positions.length > 1) {
      let context = getHighlightContext(event);
      if (!context) {
        const tqsTag = event.tags?.find(
          (/** @type {string[]} */ t) => t[0] === 'textquoteselector'
        );
        if (tqsTag) {
          context = (tqsTag[2] || '') + normalizedText + (tqsTag[3] || '');
        }
      }
      if (context) {
        const normalizedContext = normalizeWhitespace(context);
        let bestScore = -1;
        for (const pos of positions) {
          // Check surrounding text for context match
          const surroundStart = Math.max(0, pos - normalizedContext.length);
          const surroundEnd = Math.min(
            normalizedArticle.length,
            pos + normalizedText.length + normalizedContext.length
          );
          const surrounding = normalizedArticle.slice(surroundStart, surroundEnd);
          if (surrounding.includes(normalizedContext)) {
            bestPos = pos;
            bestScore = 2;
            break;
          }
          // Partial context match as fallback
          const overlap = normalizedContext
            .split(' ')
            .filter((w) => surrounding.includes(w)).length;
          if (overlap > bestScore) {
            bestScore = overlap;
            bestPos = pos;
          }
        }
      }
    }

    rawMatches.push({
      start: bestPos,
      end: bestPos + normalizedText.length,
      events: [event]
    });
  }

  // Sort by start position and merge overlapping
  rawMatches.sort((a, b) => a.start - b.start);
  /** @type {Array<{start: number, end: number, events: any[]}>} */
  const merged = [];

  for (const match of rawMatches) {
    const last = merged[merged.length - 1];
    if (last && match.start <= last.end) {
      // Overlapping — extend range and combine events
      last.end = Math.max(last.end, match.end);
      last.events.push(...match.events);
    } else {
      merged.push({ ...match });
    }
  }

  return { matched: merged, unmatched };
}

/**
 * Elements whose start/end acts as a line break in the browser's selection
 * string (window.getSelection().toString()). <br> is listed too — it is a
 * self-closing break, handled by the same code path.
 */
const BREAK_TAGS = new Set([
  'BR',
  'P',
  'DIV',
  'LI',
  'UL',
  'OL',
  'DL',
  'DT',
  'DD',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'HR',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'FIGURE',
  'FIGCAPTION',
  'DETAILS',
  'SUMMARY'
]);

/**
 * @typedef {{ node: Text | null, start: number, length: number }} TextSegment
 * A run of characters in the matchable text. `node` is the DOM text node that
 * carries them, or null for a synthetic line break that has no DOM text.
 */

/**
 * Walk a container and collect its text as segments, in document order.
 *
 * `container.textContent` is NOT usable for highlight matching: it drops <br>
 * entirely and glues adjacent blocks together, so "ended.<br>Publicly" reads
 * "ended.Publicly". A highlight created from a browser selection contains a
 * "\n" at that spot (and so do highlights from clients like Boris, whose
 * renderer keeps soft line breaks as literal newlines). Emitting a synthetic
 * "\n" segment for <br> and for block boundaries makes the text mirror the
 * selection string, and normalizeWhitespace() then matches both.
 *
 * @param {HTMLElement | null | undefined} container
 * @returns {TextSegment[]}
 */
function collectTextSegments(container) {
  /** @type {TextSegment[]} */
  const segments = [];
  if (!container) return segments;
  let cumulative = 0;

  /** @param {Text | null} node @param {number} length */
  const push = (node, length) => {
    segments.push({ node, start: cumulative, length });
    cumulative += length;
  };

  /** @param {Node} parent */
  const walk = (parent) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const len = (child.textContent || '').length;
        if (len > 0) push(/** @type {Text} */ (child), len);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const isBreak = BREAK_TAGS.has(/** @type {Element} */ (child).tagName);
        if (isBreak) push(null, 1);
        walk(child);
        if (isBreak && /** @type {Element} */ (child).tagName !== 'BR') push(null, 1);
      }
    }
  };

  walk(container);
  return segments;
}

/**
 * Text of a rendered container as the browser selection would produce it:
 * text nodes verbatim, "\n" for <br> and around block elements.
 *
 * This is the ONLY text that may be handed to matchHighlights() /
 * extractContext() for a container that injectHighlightMarks() later
 * operates on — both sides must count characters the same way.
 *
 * @param {HTMLElement | null | undefined} container
 * @returns {string}
 */
export function getMatchableText(container) {
  return collectTextSegments(container)
    .map((seg) => (seg.node ? seg.node.textContent || '' : '\n'))
    .join('');
}

/**
 * Build a mapping from normalized-text positions back to raw-text positions.
 * normalizeWhitespace collapses runs of whitespace to single spaces and trims.
 * This map lets us convert match positions (found in normalized space) to the
 * raw character offsets needed for DOM text-node splitting.
 * @param {string} rawText
 * @returns {number[]} map where map[normIndex] = rawIndex, length = norm.length + 1
 */
export function buildNormToRawMap(rawText) {
  const norm = normalizeWhitespace(rawText);
  const map = new Array(norm.length + 1);
  let ri = 0;
  let ni = 0;

  // Skip leading whitespace in raw text
  while (ri < rawText.length && /\s/.test(rawText[ri])) ri++;

  while (ni < norm.length && ri < rawText.length) {
    map[ni] = ri;
    ni++;
    if (norm[ni - 1] === ' ') {
      // The normalized space corresponds to a whitespace run in raw — skip it
      while (ri < rawText.length && /\s/.test(rawText[ri])) ri++;
    } else {
      ri++;
    }
  }
  map[norm.length] = ri; // sentinel for end positions
  return map;
}

/**
 * Inject <mark> elements into a rendered article container.
 * Uses TreeWalker to find text nodes and wrap matched ranges.
 *
 * Matches are in normalized-text positions (from matchHighlights, computed
 * against getMatchableText(container)). This function converts them to raw
 * positions via buildNormToRawMap, then walks the same text segments using
 * raw cumulative offsets.
 *
 * @param {HTMLElement} container
 * @param {Array<{start: number, end: number, events: any[]}>} matches - positions in normalized space
 * @param {Map<string, any>} [profiles] - Profile map for author names
 */
export function injectHighlightMarks(container, matches, profiles) {
  if (!matches.length || !container) return;

  // Same segmentation as getMatchableText(), so raw offsets line up with the
  // text the matches were computed against.
  const textNodes = collectTextSegments(container);
  const rawText = textNodes.map((seg) => (seg.node ? seg.node.textContent || '' : '\n')).join('');
  const normToRaw = buildNormToRawMap(rawText);

  const rawMatches = matches.map((match) => ({
    start: normToRaw[match.start] ?? 0,
    end: normToRaw[match.end] ?? rawText.length,
    events: match.events
  }));

  // For each match, find the text nodes that contain the range and wrap them
  // Process in reverse order to avoid invalidating offsets
  for (let i = rawMatches.length - 1; i >= 0; i--) {
    const match = rawMatches[i];

    // Build tooltip text from authors
    const authorNames = match.events
      .map((e) => {
        const profile = profiles?.get(e.pubkey);
        return profile ? getDisplayName(profile) : e.pubkey.slice(0, 8);
      })
      .filter((n, idx, arr) => arr.indexOf(n) === idx);
    const tooltip = `Highlighted by ${authorNames.join(', ')}`;

    const highlightIds = match.events.map((e) => e.id).join(',');
    wrapRange(textNodes, match.start, match.end, tooltip, highlightIds);
  }
}

/**
 * Wrap a character range across text nodes with a <mark> element.
 * @param {TextSegment[]} textNodes
 * @param {number} rangeStart
 * @param {number} rangeEnd
 * @param {string} tooltip
 * @param {string} highlightIds
 */
function wrapRange(textNodes, rangeStart, rangeEnd, tooltip, highlightIds) {
  for (const entry of textNodes) {
    const nodeEnd = entry.start + entry.length;

    // Skip nodes entirely before range
    if (nodeEnd <= rangeStart) continue;
    // Stop after range
    if (entry.start >= rangeEnd) break;
    // Synthetic line break (<br> / block boundary) — nothing to wrap
    if (!entry.node) continue;

    const node = entry.node;
    const text = node.textContent || '';

    // Calculate offsets within this text node
    const localStart = Math.max(0, rangeStart - entry.start);
    const localEnd = Math.min(text.length, rangeEnd - entry.start);

    if (localStart >= text.length || localEnd <= 0) continue;

    // Split the text node and wrap the middle part
    const mark = document.createElement('mark');
    mark.className = 'reader-highlight';
    mark.title = tooltip;
    mark.dataset.highlightIds = highlightIds;

    if (localEnd < text.length) {
      node.splitText(localEnd);
    }
    const highlightNode = localStart > 0 ? node.splitText(localStart) : node;

    const parent = highlightNode.parentNode;
    if (parent) {
      parent.insertBefore(mark, highlightNode);
      mark.appendChild(highlightNode);
    }
  }
}

/**
 * Extract surrounding context text for a selection within article text.
 * Used when creating highlights to populate the NIP-84 `context` tag.
 * @param {string} fullText - Article plain text
 * @param {string} selectedText - The selected/highlighted text
 * @param {number} [charsBefore=100] - Characters of context before selection
 * @param {number} [charsAfter=100] - Characters of context after selection
 * @returns {string} Context string
 */
export function extractContext(fullText, selectedText, charsBefore = 100, charsAfter = 100) {
  if (!fullText || !selectedText) return '';

  const normalizedFull = normalizeWhitespace(fullText);
  const normalizedSelected = normalizeWhitespace(selectedText);

  const idx = normalizedFull.indexOf(normalizedSelected);
  if (idx === -1) return '';

  const start = Math.max(0, idx - charsBefore);
  const end = Math.min(normalizedFull.length, idx + normalizedSelected.length + charsAfter);

  return normalizedFull.slice(start, end);
}
