/**
 * Bible reference parsing + canonicalization to German short form.
 *
 * Uses `bible-passage-reference-parser` (MIT) to parse free-text input,
 * then maps OSIS book codes to canonical German abbreviations and emits
 * the German Schreibweise (e.g. "Mt 5,3-12").
 *
 * The parser is loaded via dynamic import so the ~150 KB bundle only
 * lands on routes that actually need it (the EKW resource form).
 */

/**
 * Canonical German Bible book table — single source of truth for OSIS↔DE
 * mappings, short Schreibweisen, and long German names.
 * Source: standard German Bible (Loccumer Richtlinien) abbreviations.
 * Covers all 66 protestant books + a few deutero-canonicals the parser knows.
 *
 * @type {ReadonlyArray<{ osis: string, short: string, long: string }>}
 */
const BOOKS_TABLE = Object.freeze([
  // Pentateuch
  { osis: 'Gen', short: '1 Mo', long: '1. Mose' },
  { osis: 'Exod', short: '2 Mo', long: '2. Mose' },
  { osis: 'Lev', short: '3 Mo', long: '3. Mose' },
  { osis: 'Num', short: '4 Mo', long: '4. Mose' },
  { osis: 'Deut', short: '5 Mo', long: '5. Mose' },
  // Historical books
  { osis: 'Josh', short: 'Jos', long: 'Josua' },
  { osis: 'Judg', short: 'Ri', long: 'Richter' },
  { osis: 'Ruth', short: 'Rut', long: 'Rut' },
  { osis: '1Sam', short: '1 Sam', long: '1. Samuel' },
  { osis: '2Sam', short: '2 Sam', long: '2. Samuel' },
  { osis: '1Kgs', short: '1 Kön', long: '1. Könige' },
  { osis: '2Kgs', short: '2 Kön', long: '2. Könige' },
  { osis: '1Chr', short: '1 Chr', long: '1. Chronik' },
  { osis: '2Chr', short: '2 Chr', long: '2. Chronik' },
  { osis: 'Ezra', short: 'Esr', long: 'Esra' },
  { osis: 'Neh', short: 'Neh', long: 'Nehemia' },
  { osis: 'Esth', short: 'Est', long: 'Ester' },
  // Wisdom & poetry
  { osis: 'Job', short: 'Hi', long: 'Hiob' },
  { osis: 'Ps', short: 'Ps', long: 'Psalm' },
  { osis: 'Prov', short: 'Spr', long: 'Sprüche' },
  { osis: 'Eccl', short: 'Pred', long: 'Prediger' },
  { osis: 'Song', short: 'Hld', long: 'Hohelied' },
  // Major prophets
  { osis: 'Isa', short: 'Jes', long: 'Jesaja' },
  { osis: 'Jer', short: 'Jer', long: 'Jeremia' },
  { osis: 'Lam', short: 'Klgl', long: 'Klagelieder' },
  { osis: 'Ezek', short: 'Hes', long: 'Hesekiel' },
  { osis: 'Dan', short: 'Dan', long: 'Daniel' },
  // Minor prophets
  { osis: 'Hos', short: 'Hos', long: 'Hosea' },
  { osis: 'Joel', short: 'Joel', long: 'Joel' },
  { osis: 'Amos', short: 'Am', long: 'Amos' },
  { osis: 'Obad', short: 'Obd', long: 'Obadja' },
  { osis: 'Jonah', short: 'Jona', long: 'Jona' },
  { osis: 'Mic', short: 'Mi', long: 'Micha' },
  { osis: 'Nah', short: 'Nah', long: 'Nahum' },
  { osis: 'Hab', short: 'Hab', long: 'Habakuk' },
  { osis: 'Zeph', short: 'Zef', long: 'Zefanja' },
  { osis: 'Hag', short: 'Hag', long: 'Haggai' },
  { osis: 'Zech', short: 'Sach', long: 'Sacharja' },
  { osis: 'Mal', short: 'Mal', long: 'Maleachi' },
  // Gospels & Acts
  { osis: 'Matt', short: 'Mt', long: 'Matthäus' },
  { osis: 'Mark', short: 'Mk', long: 'Markus' },
  { osis: 'Luke', short: 'Lk', long: 'Lukas' },
  { osis: 'John', short: 'Joh', long: 'Johannes' },
  { osis: 'Acts', short: 'Apg', long: 'Apostelgeschichte' },
  // Pauline epistles
  { osis: 'Rom', short: 'Röm', long: 'Römer' },
  { osis: '1Cor', short: '1 Kor', long: '1. Korinther' },
  { osis: '2Cor', short: '2 Kor', long: '2. Korinther' },
  { osis: 'Gal', short: 'Gal', long: 'Galater' },
  { osis: 'Eph', short: 'Eph', long: 'Epheser' },
  { osis: 'Phil', short: 'Phil', long: 'Philipper' },
  { osis: 'Col', short: 'Kol', long: 'Kolosser' },
  { osis: '1Thess', short: '1 Thess', long: '1. Thessalonicher' },
  { osis: '2Thess', short: '2 Thess', long: '2. Thessalonicher' },
  { osis: '1Tim', short: '1 Tim', long: '1. Timotheus' },
  { osis: '2Tim', short: '2 Tim', long: '2. Timotheus' },
  { osis: 'Titus', short: 'Tit', long: 'Titus' },
  { osis: 'Phlm', short: 'Phlm', long: 'Philemon' },
  // General epistles
  { osis: 'Heb', short: 'Hebr', long: 'Hebräer' },
  { osis: 'Jas', short: 'Jak', long: 'Jakobus' },
  { osis: '1Pet', short: '1 Petr', long: '1. Petrus' },
  { osis: '2Pet', short: '2 Petr', long: '2. Petrus' },
  { osis: '1John', short: '1 Joh', long: '1. Johannes' },
  { osis: '2John', short: '2 Joh', long: '2. Johannes' },
  { osis: '3John', short: '3 Joh', long: '3. Johannes' },
  { osis: 'Jude', short: 'Jud', long: 'Judas' },
  // Apocalypse
  { osis: 'Rev', short: 'Offb', long: 'Offenbarung' },
  // Common deutero-canonicals (used in some German bibles)
  { osis: 'Tob', short: 'Tob', long: 'Tobit' },
  { osis: 'Jdt', short: 'Jdt', long: 'Judit' },
  { osis: 'Wis', short: 'Weish', long: 'Weisheit' },
  { osis: 'Sir', short: 'Sir', long: 'Sirach' },
  { osis: 'Bar', short: 'Bar', long: 'Baruch' },
  { osis: '1Macc', short: '1 Makk', long: '1. Makkabäer' },
  { osis: '2Macc', short: '2 Makk', long: '2. Makkabäer' }
]);

/** @type {Record<string, string>} */
const OSIS_TO_DE = Object.fromEntries(BOOKS_TABLE.map((b) => [b.osis, b.short]));

/**
 * German book entries (short + long form) in canonical (biblical) order —
 * the data source for the Bibelstelle typeahead.
 *
 * @type {ReadonlyArray<{ short: string, long: string }>}
 */
export const BIBLE_BOOKS = Object.freeze(
  BOOKS_TABLE.map(({ short, long }) => Object.freeze({ short, long }))
);

/**
 * Strip diacritics + lowercase so "Matthäus" and "matthaus" match each other.
 *
 * @param {string} s
 * @returns {string}
 */
function fold(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Find books whose short or long German name contains `query`
 * (accent-insensitive). Prefix matches are ranked first.
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{ short: string, long: string }>}
 */
export function findBookMatches(query, limit = 8) {
  const q = fold(query.trim());
  if (!q) return [];
  /** @type {Array<{ short: string, long: string }>} */
  const prefix = [];
  /** @type {Array<{ short: string, long: string }>} */
  const contains = [];
  for (const b of BIBLE_BOOKS) {
    const s = fold(b.short);
    const l = fold(b.long);
    if (s.startsWith(q) || l.startsWith(q)) prefix.push(b);
    else if (s.includes(q) || l.includes(q)) contains.push(b);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/**
 * If the input exactly matches a known German book name (short or long form,
 * accent-insensitive), return that entry — used to give a "Kapitel ergänzen"
 * hint instead of an "unparseable" warning when the user has just typed a
 * book name without a chapter yet.
 *
 * @param {string} query
 * @returns {{ short: string, long: string } | null}
 */
export function findExactBook(query) {
  const q = fold(query.trim());
  if (!q) return null;
  for (const b of BIBLE_BOOKS) {
    if (fold(b.short) === q || fold(b.long) === q) return b;
  }
  return null;
}

/**
 * Format a single OSIS entity string ("Matt.5.3-Matt.5.12") to German short.
 * Falls back to the OSIS book code if no German mapping is registered.
 *
 * @param {string} osisEntity
 * @returns {string}
 */
function formatOne(osisEntity) {
  const [start, end] = osisEntity.split('-');
  const [sb, sc, sv] = start.split('.');
  const sBook = OSIS_TO_DE[sb] ?? sb;

  if (!end) {
    if (sv) return `${sBook} ${sc},${sv}`;
    return `${sBook} ${sc}`;
  }

  const [eb, ec, ev] = end.split('.');
  if (sb === eb && sc === ec && sv && ev) {
    // verse range within chapter: "Mt 5,3-12"
    return `${sBook} ${sc},${sv}-${ev}`;
  }
  if (sb === eb && sc !== ec) {
    // cross-chapter range: "Hes 1,1-3,15"
    return `${sBook} ${sc},${sv ?? '1'}-${ec},${ev ?? '1'}`;
  }
  // cross-book (rare in everyday use)
  const eBook = OSIS_TO_DE[eb] ?? eb;
  return `${sBook} ${sc}${sv ? ',' + sv : ''}-${eBook} ${ec}${ev ? ',' + ev : ''}`;
}

/**
 * Convert a full OSIS string (comma-separated entities) to German short form.
 * Uses "; " as the entity separator so the comma can serve as the verse
 * separator in each part.
 *
 * @param {string} osis
 * @returns {string}
 */
function osisToDeShort(osis) {
  return osis
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(formatOne)
    .join('; ');
}

/** @type {Promise<{ parser: any }> | null} */
let parserPromise = null;

/**
 * Lazy-load the parser + German lang module. Memoized so subsequent calls
 * reuse the same instance.
 *
 * @returns {Promise<{ parser: any }>}
 */
function loadParser() {
  if (!parserPromise) {
    parserPromise = (async () => {
      const [{ bcv_parser }, lang] = await Promise.all([
        import('bible-passage-reference-parser/esm/bcv_parser.js'),
        import('bible-passage-reference-parser/esm/lang/de.js')
      ]);
      const parser = new bcv_parser(lang);
      parser.set_options({ punctuation_strategy: 'eu' });
      return { parser };
    })();
  }
  return parserPromise;
}

/**
 * @typedef {Object} BibleReferenceResult
 * @property {boolean} ok - whether the input parsed to a real reference
 * @property {string | null} canonical - German short form (e.g. "Mt 5,3-12") when ok
 * @property {string | null} osis - canonical OSIS string when ok
 */

/**
 * Build a bibleserver.com deep link for a canonical German short reference
 * (e.g. `"Mt 5,3-12"`). Defaults to the Lutherbibel 2017 (`LUT`) — the most
 * ecumenical choice for the EKKW context. Bibleserver accepts the canonical
 * short form directly in the URL, so no OSIS conversion is required.
 *
 * Heuristic guard: the input must start with a known German book name (short
 * or long form, accent-insensitive) followed by whitespace and at least one
 * digit. This prevents linkifying free-form text that happens to land in a
 * Bible-reference slot (e.g. notes the user typed). Multi-references like
 * `"Mt 5,3-12; Lk 6,20-26"` pass the guard via their leading book and render
 * as a single link covering the whole expression — bibleserver handles
 * multi-passage URLs natively.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function toBibleServerUrl(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (!/\d/.test(trimmed)) return null;
  const folded = fold(trimmed);
  const startsWithKnownBook = BIBLE_BOOKS.some((b) => {
    const fs = fold(b.short);
    const fl = fold(b.long);
    return folded.startsWith(fs + ' ') || folded.startsWith(fl + ' ');
  });
  if (!startsWithKnownBook) return null;
  return `https://www.bibleserver.com/LUT/${encodeURIComponent(trimmed)}`;
}

/**
 * Parse a free-text bible reference and return its canonical German short form.
 * Returns `{ ok: false, canonical: null, osis: null }` for unparseable input.
 *
 * @param {string} input
 * @returns {Promise<BibleReferenceResult>}
 */
export async function parseAndCanonicalize(input) {
  const trimmed = input?.trim();
  if (!trimmed) {
    return { ok: false, canonical: null, osis: null };
  }
  const { parser } = await loadParser();
  parser.parse(trimmed);
  const osis = parser.osis();
  if (!osis) {
    return { ok: false, canonical: null, osis: null };
  }
  return { ok: true, canonical: osisToDeShort(osis), osis };
}
