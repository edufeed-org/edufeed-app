// Who the material is for. nope-mcp tags relays with an audience (AMB_RELAY_AUDIENCES) and a
// search with `audience` covers the general relays plus the ones for it. Host-free.

/** The audience names edufeed's nope-mcp deployment uses. */
export const AUDIENCES = /** @type {const} */ (['school', 'higher-education']);

const SCHOOL =
  /\b(klasse|klassenstufe|jahrgang|jahrgangsstufe|jgst|grade|year)\.?\s*\d|\b\d{1,2}\.\s*(klasse|jahrgang)|grundschul|gymnasi|realschul|hauptschul|gesamtschul|oberstufe|sekundarstufe|\bsek\.?\s*(i|ii|1|2)\b|schuler|unterrichtsreihe|unterrichtseinheit|primary school|secondary school|high school|\bpupils?\b/;
const HIGHER =
  /hochschul|universit|studierende|\bstudent(en|innen|in)?\b|\bstudium\b|vorlesung|\bseminar\b|bachelor|masterstudi|masterarbeit|higher education|undergraduate|\blectures?\b/;

/**
 * The audience a question names, or undefined when it names none or both.
 * @param {string} text
 * @returns {typeof AUDIENCES[number] | undefined}
 */
export function detectAudience(text) {
  const folded = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const school = SCHOOL.test(folded);
  const higher = HIGHER.test(folded);
  if (school === higher) return undefined;
  return school ? 'school' : 'higher-education';
}

const GRADE =
  '(?:klasse|klassenstufe|jahrgangsstufe|jahrgang|jgst\\.?|grade|year)\\s*\\d{1,2}(?:\\s*(?:-|–|bis|und|/)\\s*\\d{1,2})?|\\d{1,2}\\.\\s*(?:klasse|jahrgangsstufe|jahrgang)|sekundarstufe\\s*(?:ii|i|2|1)(?![\\p{L}\\d])|sek\\.?\\s*(?:ii|i|2|1)(?![\\p{L}\\d])';
const GROUP =
  '(?:grundschule|gymnasium|realschule|hauptschule|gesamtschule|oberstufe|schule|schüler(?:innen|:innen|\\*innen)?(?:\\s+und\\s+schüler)?|studierende|studenten|studentinnen|hochschule|hochschullehre|universität|uni|students|pupils|university|school)(?![\\p{L}])';
// a grade ("Klasse 7", with the words leading to it) or a group introduced by "für"/"for"
const QUALIFIER = new RegExp(
  `\\s*,?\\s*(?:(?<![\\p{L}])(?:in|im|an|der|die|den|für|fuer|for)\\s+)*(?:${GRADE})` +
    `|\\s*,?\\s*(?<![\\p{L}])(?:für|fuer|for)\\s+(?:(?:die|den|das|der|the)\\s+)?${GROUP}`,
  'giu'
);

/**
 * The search words without the audience qualifier ("Fotosynthese, Klasse 7" → "Fotosynthese"):
 * the audience travels as its own parameter, and left in the query it drags unrelated hits in.
 * Only qualifiers go — a question about students keeps its words — and never the whole text.
 * @param {string} text
 */
export function withoutAudienceQualifier(text) {
  const rest = text
    .replace(QUALIFIER, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '');
  return rest || text;
}
