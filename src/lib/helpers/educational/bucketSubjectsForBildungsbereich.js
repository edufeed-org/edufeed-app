import { BILDUNGSBEREICHE } from './bildungsbereich.js';

/**
 * Bucket a flat list of subject concepts into the `aboutByVocab` shape the
 * AMB resource wizard's step-4 picker binds to.
 *
 * The wizard stores per-vocab subject selections (`Record<vocabKey,
 * CompactConcept[]>`) so it can render multiple subject pickers in parallel
 * for Bildungsbereiche like `extra` (`schulfaecher` + `hochschulfaecher`).
 * Both edit-mode prefill and LLM enrichment receive subjects as a flat list,
 * with no per-concept signal of which vocab they came from. We follow the
 * same heuristic as the existing edit-mode prefill (see `applyPrefillFromAmbEvent`):
 * dump the whole list under the *first* vocab key of the current
 * Bildungsbereich.
 *
 * @typedef {{ id: string, label?: string, prefLabel?: string }} SubjectInput
 * @typedef {{ id: string, label: string }} CompactConcept
 *
 * @param {SubjectInput[] | undefined} subjects
 * @param {string | undefined} bildungsbereich - one of the BILDUNGSBEREICH_KEYS, or empty
 * @returns {Record<string, CompactConcept[]> | null}
 *   Map of vocabKey → concept list, or null when bucketing is impossible
 *   (no subjects, no bildungsbereich, or the bildungsbereich has no subject vocab).
 */
export function bucketSubjectsForBildungsbereich(subjects, bildungsbereich) {
  if (!subjects || subjects.length === 0) return null;
  if (!bildungsbereich) return null;
  const config = /** @type {any} */ (BILDUNGSBEREICHE)[bildungsbereich];
  if (!config || !config.subjectVocabKeys || config.subjectVocabKeys.length === 0) {
    return null;
  }
  const firstKey = config.subjectVocabKeys[0];
  /** @type {CompactConcept[]} */
  const compact = subjects.map((s) => ({
    id: s.id,
    label: s.label ?? s.prefLabel ?? ''
  }));
  return { [firstKey]: compact };
}
