/**
 * Project published kind-39738 Concept events into a flat, German-locale-sorted,
 * deduplicated label list for the EKW step-4 keyword typeahead.
 *
 * Replaces the static `EKW_KEYWORD_SUGGESTIONS` array — the same labels are now
 * sourced from the `ekw-keywords` ConceptScheme published by
 * `pnpm run publish:vocabs`. Per the design spec (decisions Q3a/Q4a in
 * docs/superpowers/specs/2026-05-04-ekw-step4-lrt-keywords-design.md), the
 * suggestion list informs but does not constrain — free-text keywords still
 * round-trip verbatim, so a Concept event without a German prefLabel is
 * skipped rather than fallen back to the d-tag.
 */
import { parseConcept } from 'nostr-vocab-core/parsers';

/**
 * @param {ReadonlyArray<import('nostr-tools').NostrEvent>} conceptEvents
 * @returns {string[]}
 */
export function ekwKeywordsFromConcepts(conceptEvents) {
  const labels = new Set();
  for (const evt of conceptEvents) {
    const parsed = /** @type {{ prefLabels?: { value: string, lang: string }[] }} */ (
      parseConcept(evt)
    );
    const de = parsed.prefLabels?.find((p) => p.lang === 'de');
    const label = de?.value || parsed.prefLabels?.[0]?.value;
    if (label) labels.add(label);
  }
  return Array.from(labels).sort((a, b) => a.localeCompare(b, 'de'));
}
