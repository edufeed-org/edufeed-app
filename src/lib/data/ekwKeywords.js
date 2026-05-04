/**
 * EKW keyword suggestion list.
 *
 * Source of truth for the EKKW-specific keyword typeahead used by step 4 of
 * the EKW variant of ResourceFormWizard. Per the design spec
 * (docs/superpowers/specs/2026-05-04-ekw-step4-lrt-keywords-design.md):
 *
 *   - Decision Q3(a): pure typeahead — the suggestion list informs but does
 *     not constrain. Free-text keywords entered by the user are preserved
 *     verbatim.
 *   - Decision Q4(a): the published value is exactly what the user picked
 *     (or typed). No SKOS concept-ID expansion, no parent inference.
 *
 * Note: unlike `ekwLearningResourceTypes.js`, keywords are stored as raw
 * strings (per Q4a), so this file ships no migration helper or namespace IRI.
 *
 * The tree below mirrors the CEO's `keywordGroups` from Editor_4.html
 * exactly. The flattened, deduplicated, German-sorted suggestion list is
 * the only thing exported — filtering happens in the wizard.
 */

/**
 * Source tree from the CEO's Editor_4.html mockup. Not exported — consumers
 * use the derived `EKW_KEYWORD_SUGGESTIONS` flat array.
 *
 * @type {Record<string, string[]>}
 */
const EKW_KEYWORD_TREE = {
  Gott: ['Gottesbilder', 'Glauben / Zweifel', 'Trinität'],
  'Mensch, Gemeinschaft, Handeln': [
    'Zehn Gebote',
    'Gerechtigkeit',
    'Frieden',
    'Schöpfungsbewahrung',
    'Menschenwürde',
    'Existenzielle Fragen / Grundfragen des Lebens',
    'Diakonie'
  ],
  Schöpfung: [],
  'Jesus Christus': [
    'Geschichtlicher Jesus / Leben und Umwelt Jesu',
    'Geglaubter Christus / Hoheitsbezeichnungen',
    'Botschaft und Handeln Jesu',
    'Passion',
    'Auferstehung',
    'Nachfolge'
  ],
  'Kirche / Gemeinde': [
    'Kirchenräume',
    'Gemeindeleben',
    'Ämter',
    'Gottesdienst',
    'Abendmahl',
    'Konfessionen'
  ],
  'Kirchenjahr / Feste': [
    'Abschied / Silvester',
    'Neubeginn / Neujahr',
    'Dreikönige',
    'Palmsonntag',
    'Gründonnerstag',
    'Karfreitag',
    'Ostern',
    'Himmelfahrt',
    'Pfingsten',
    'Fronleichnam',
    'Erntedank',
    'Advent',
    'Weihnachten',
    'Ewigkeitssonntag / Totensonntag'
  ],
  'Ausdrucksformen des Glaubens': [
    'Gebet',
    'Meditation',
    'Taufe',
    'Abendmahl',
    'Beichte',
    'Gottesdienst',
    'Kasualgottesdienst',
    'Sakramente allgemein'
  ],
  Bibel: [
    'Bibel als Text(sammlung)',
    'Bibel als Glaubenszeugnis',
    'Konkrete biblische Geschichten',
    'Religiöse Symbole'
  ],
  'Religionen / Weltanschauungen': [
    'Christentum',
    'Judentum',
    'Islam',
    'Buddhismus',
    'Hinduismus',
    'Daoismus',
    "Bahá'í",
    'indigene Religionen',
    'säkulare Weltanschauungen'
  ]
};

/**
 * Flat, deduplicated, German-locale-sorted list of all parent + child
 * keyword labels. Drives the typeahead suggestions in the EKW step 4 UI.
 *
 * @type {ReadonlyArray<string>}
 */
// Sort is for display ordering only; case/diacritic-insensitive matching
// for the typeahead is the wizard's responsibility (Task 8).
export const EKW_KEYWORD_SUGGESTIONS = Object.freeze(
  Array.from(
    new Set([...Object.keys(EKW_KEYWORD_TREE), ...Object.values(EKW_KEYWORD_TREE).flat()])
  ).sort((a, b) => a.localeCompare(b, 'de'))
);

/**
 * Normalize for accent/case-insensitive substring match.
 * @param {string} s
 * @returns {string}
 */
function normalize(s) {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Returns up to `limit` keyword suggestions whose accent/case-insensitive
 * normalization contains `query`. Anything in `alreadySelected` is excluded.
 * Results preserve the source order from `EKW_KEYWORD_SUGGESTIONS`.
 *
 * @param {string} query
 * @param {ReadonlyArray<string> | Set<string>} alreadySelected
 * @param {number} [limit=8]
 * @returns {string[]}
 */
export function matchKeywordSuggestions(query, alreadySelected, limit = 8) {
  const q = normalize((query ?? '').trim());
  if (!q) return [];
  const skip = alreadySelected instanceof Set ? alreadySelected : new Set(alreadySelected);
  const out = [];
  for (const candidate of EKW_KEYWORD_SUGGESTIONS) {
    if (skip.has(candidate)) continue;
    if (normalize(candidate).includes(q)) {
      out.push(candidate);
      if (out.length >= limit) break;
    }
  }
  return out;
}
