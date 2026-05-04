/**
 * EKW Learning Resource Type vocabulary.
 *
 * Source of truth for the EKKW-specific learningResourceType taxonomy used by
 * step 4 of the EKW variant of ResourceFormWizard. Per the design spec
 * (docs/superpowers/specs/2026-05-04-ekw-step4-lrt-keywords-design.md):
 *
 *   - Decision Q1(a): published in the standard `learningResourceType` field
 *     on kind-30142 events with EKW-namespaced concept IDs.
 *   - Decision Q2(b): leaf-preferred. Childless parents act as leaves;
 *     parents with children are not selectable on their own.
 *
 * Concept IDs use a deterministic, parent-scoped slug:
 *   childless parent  → ${EKW_LRT_ID_PREFIX}<parent-slug>
 *   parent + child    → ${EKW_LRT_ID_PREFIX}<parent-slug>/<child-slug>
 *
 * Display labels for the picker are "Parent › Child" (Q5).
 */

import { EKW_NAMESPACE_IRI } from '$lib/helpers/educational/ekwNamespace.js';

/** Concept-ID prefix for every EKW LRT leaf. */
export const EKW_LRT_ID_PREFIX = `${EKW_NAMESPACE_IRI}lrt/`;

/**
 * Source tree from the CEO's Editor_4.html mockup. Not exported — consumers
 * use the derived `EKW_LEARNING_RESOURCE_TYPES` flat array.
 *
 * @type {Record<string, string[]>}
 */
const EKW_LRT_TREE = {
  Unterrichtsplanung: [
    'Stundenentwurf',
    'Unterrichtsbaustein',
    'Unterrichtsidee',
    'Unterrichtsreihe',
    'Go & Teach',
    'Unterrichtseinheit und -sequenz',
    'Projekt'
  ],
  Arbeitsblatt: [],
  'Textbaustein zum Wiederverwenden': [
    'Anforderungssituation',
    'Arbeits-/Rechercheauftrag',
    'Darstellung Sachverhalt',
    'Definition',
    'Merksatz',
    'Fakt',
    'Beispiel'
  ],
  'Biblische Geschichte': [],
  Quelle: [],
  'Erzählung / Geschichte': [],
  'bebilderte Geschichte': [],
  'Liedtext/Musiknoten': [],
  Audio: [
    'Erklär-Audio',
    'Sprach- und Lernaudio',
    'Radio, Podcastfolge und Interview',
    'Klang und Tonaufnahme',
    'Musik',
    'Vortrag (Audio-Aufzeichnung / Lesung)',
    'Hörverstehen'
  ],
  Bild: [
    'Veranschaulichung, Schaubild, Tafelbild',
    'Mal- und Bastelvorlage',
    'Foto',
    'Clipart, Pictogramm, Icon',
    'Cartoon, Comic',
    'Karte',
    'Poster und Plakat',
    'Gemälde, Kunstwerke und Zeichnungen',
    'Graph, Diagramm und Charts'
  ],
  Video: [
    'Kurzfilm',
    'Film',
    'Lern- und Übungsvideo',
    'Erklärvideo und gefilmtes Experiment',
    'Vortrags- und Unterrichtsaufzeichnung'
  ],
  'Interaktives Medium': [
    'Lernpfad',
    'Adaptives Lernangebot',
    'Simulation',
    'Virtual Reality',
    'Augmented Reality',
    'Webseite',
    'Wiki',
    'Game'
  ],
  Spiel: ['Aufwärm-/Kennenlernspiel', 'Lernspiel / Spielanleitung', 'Rollenspiel'],
  Stationenlernen: [],
  'Übung, Lernkontrolle': [
    'Lösungs(beispiel) und Erwartungshorizont',
    'Selbsttest-Aufgabe',
    'Klausur, Klassenarbeit, Test',
    'Checkliste'
  ],
  Evaluationsbogen: [],
  'Fragebogen und Umfrage': [],
  'Nachschlagewerk, Lexikon, Lexikonartikel': [],
  Präsentation: [],
  Lehrbuch: [],
  'Sachinformation/Grundlagentext': []
};

/**
 * Deterministic slug: lowercase, accent-strip, collapse non-alphanumerics to "-",
 * trim leading/trailing "-".
 *
 * @param {string} s
 * @returns {string}
 */
function slug(s) {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (ä→a, é→e, …)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @typedef {Object} EkwLrtLeaf
 * @property {string} id - EKW-namespaced concept IRI
 * @property {string} label - User-facing leaf label (just the leaf, not the parent)
 * @property {string | null} parentLabel - Parent group name, or null for childless parents
 */

/**
 * Flat array of selectable LRT leaves derived from EKW_LRT_TREE.
 *
 * @type {ReadonlyArray<EkwLrtLeaf>}
 */
export const EKW_LEARNING_RESOURCE_TYPES = Object.freeze(
  Object.entries(EKW_LRT_TREE).flatMap(
    /** @returns {EkwLrtLeaf[]} */
    ([parent, children]) => {
      if (children.length === 0) {
        return [
          Object.freeze({
            id: `${EKW_LRT_ID_PREFIX}${slug(parent)}`,
            label: parent,
            parentLabel: null
          })
        ];
      }
      return children.map((child) =>
        Object.freeze({
          id: `${EKW_LRT_ID_PREFIX}${slug(parent)}/${slug(child)}`,
          label: child,
          parentLabel: parent
        })
      );
    }
  )
);

/**
 * Adapter: convert EKW_LEARNING_RESOURCE_TYPES into the SKOSConcept shape
 * consumed by SKOSDropdown's `concepts` prop. The display label hugs the
 * picker's "Parent › Child" convention (Q5 decision) so users see hierarchy
 * context without a tree UI.
 *
 * Returns SKOSConcept-shaped objects (matches `labels: Record<string, string>`
 * convention used by `SKOSDropdown` and `getConceptLabel` in skosLoader.js).
 *
 * @returns {Array<{ id: string, labels: { de: string } }>}
 */
export function toSkosConcepts() {
  return EKW_LEARNING_RESOURCE_TYPES.map((leaf) => ({
    id: leaf.id,
    labels: {
      de: leaf.parentLabel ? `${leaf.parentLabel} › ${leaf.label}` : leaf.label
    }
  }));
}

/**
 * Normalize a label for matching: lowercase, accent-strip, collapse internal
 * whitespace, trim. Used by `migrateLrtForEkw` so legacy data with quirky
 * casing/spacing still maps cleanly to the EKW vocabulary.
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeLabel(s) {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a label → leaf lookup once at module load. Keys cover both the bare
// leaf label and the canonical "Parent › Child" picker label, so legacy events
// that stored either form round-trip cleanly.
const _leafByNormalizedLabel = new Map();
for (const leaf of EKW_LEARNING_RESOURCE_TYPES) {
  _leafByNormalizedLabel.set(normalizeLabel(leaf.label), leaf);
  if (leaf.parentLabel) {
    _leafByNormalizedLabel.set(normalizeLabel(`${leaf.parentLabel} › ${leaf.label}`), leaf);
  }
}

/**
 * @typedef {Object} CompactConcept
 * @property {string} id
 * @property {string} label
 */

/**
 * Best-effort migration of persisted learningResourceType concepts to the EKW
 * vocabulary. For each input concept:
 *
 *   1. If the id already starts with `EKW_LRT_ID_PREFIX`, pass through verbatim.
 *   2. Else if the (normalized) label matches an EKW leaf, swap to that leaf
 *      (replacing both id and label with the canonical bare leaf label).
 *   3. Else drop the entry and warn to console.
 *
 * Tolerates `null` / `undefined` input.
 *
 * @param {ReadonlyArray<CompactConcept> | null | undefined} concepts
 * @returns {CompactConcept[]}
 */
export function migrateLrtForEkw(concepts) {
  if (!concepts || concepts.length === 0) return [];
  /** @type {CompactConcept[]} */
  const out = [];
  for (const concept of concepts) {
    if (!concept || typeof concept.id !== 'string') continue;
    if (concept.id.startsWith(EKW_LRT_ID_PREFIX)) {
      out.push({ id: concept.id, label: concept.label ?? '' });
      continue;
    }
    const matched = _leafByNormalizedLabel.get(normalizeLabel(concept.label ?? ''));
    if (matched) {
      out.push({ id: matched.id, label: matched.label });
    } else {
      console.warn('[ekw] dropping non-EKW LRT concept on edit load:', concept);
    }
  }
  return out;
}
