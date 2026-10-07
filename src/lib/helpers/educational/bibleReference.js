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
 * mappings, short Schreibweisen, long German names, and USFM book codes
 * (used to build die-bibel.de deep links).
 *
 * Source: standard German Bible (Loccumer Richtlinien) abbreviations,
 * USFM 3-letter codes per UBS ICAP Standard Format Markers.
 * Covers all 66 protestant books + a few deutero-canonicals the parser knows.
 *
 * @type {ReadonlyArray<{ osis: string, short: string, long: string, usfm: string }>}
 */
const BOOKS_TABLE = Object.freeze([
  // Pentateuch
  { osis: 'Gen', short: '1 Mo', long: '1. Mose', usfm: 'GEN' },
  { osis: 'Exod', short: '2 Mo', long: '2. Mose', usfm: 'EXO' },
  { osis: 'Lev', short: '3 Mo', long: '3. Mose', usfm: 'LEV' },
  { osis: 'Num', short: '4 Mo', long: '4. Mose', usfm: 'NUM' },
  { osis: 'Deut', short: '5 Mo', long: '5. Mose', usfm: 'DEU' },
  // Historical books
  { osis: 'Josh', short: 'Jos', long: 'Josua', usfm: 'JOS' },
  { osis: 'Judg', short: 'Ri', long: 'Richter', usfm: 'JDG' },
  { osis: 'Ruth', short: 'Rut', long: 'Rut', usfm: 'RUT' },
  { osis: '1Sam', short: '1 Sam', long: '1. Samuel', usfm: '1SA' },
  { osis: '2Sam', short: '2 Sam', long: '2. Samuel', usfm: '2SA' },
  { osis: '1Kgs', short: '1 Kön', long: '1. Könige', usfm: '1KI' },
  { osis: '2Kgs', short: '2 Kön', long: '2. Könige', usfm: '2KI' },
  { osis: '1Chr', short: '1 Chr', long: '1. Chronik', usfm: '1CH' },
  { osis: '2Chr', short: '2 Chr', long: '2. Chronik', usfm: '2CH' },
  { osis: 'Ezra', short: 'Esr', long: 'Esra', usfm: 'EZR' },
  { osis: 'Neh', short: 'Neh', long: 'Nehemia', usfm: 'NEH' },
  { osis: 'Esth', short: 'Est', long: 'Ester', usfm: 'EST' },
  // Wisdom & poetry
  { osis: 'Job', short: 'Hi', long: 'Hiob', usfm: 'JOB' },
  { osis: 'Ps', short: 'Ps', long: 'Psalm', usfm: 'PSA' },
  { osis: 'Prov', short: 'Spr', long: 'Sprüche', usfm: 'PRO' },
  { osis: 'Eccl', short: 'Pred', long: 'Prediger', usfm: 'ECC' },
  { osis: 'Song', short: 'Hld', long: 'Hohelied', usfm: 'SNG' },
  // Major prophets
  { osis: 'Isa', short: 'Jes', long: 'Jesaja', usfm: 'ISA' },
  { osis: 'Jer', short: 'Jer', long: 'Jeremia', usfm: 'JER' },
  { osis: 'Lam', short: 'Klgl', long: 'Klagelieder', usfm: 'LAM' },
  { osis: 'Ezek', short: 'Hes', long: 'Hesekiel', usfm: 'EZK' },
  { osis: 'Dan', short: 'Dan', long: 'Daniel', usfm: 'DAN' },
  // Minor prophets
  { osis: 'Hos', short: 'Hos', long: 'Hosea', usfm: 'HOS' },
  { osis: 'Joel', short: 'Joel', long: 'Joel', usfm: 'JOL' },
  { osis: 'Amos', short: 'Am', long: 'Amos', usfm: 'AMO' },
  { osis: 'Obad', short: 'Obd', long: 'Obadja', usfm: 'OBA' },
  { osis: 'Jonah', short: 'Jona', long: 'Jona', usfm: 'JON' },
  { osis: 'Mic', short: 'Mi', long: 'Micha', usfm: 'MIC' },
  { osis: 'Nah', short: 'Nah', long: 'Nahum', usfm: 'NAM' },
  { osis: 'Hab', short: 'Hab', long: 'Habakuk', usfm: 'HAB' },
  { osis: 'Zeph', short: 'Zef', long: 'Zefanja', usfm: 'ZEP' },
  { osis: 'Hag', short: 'Hag', long: 'Haggai', usfm: 'HAG' },
  { osis: 'Zech', short: 'Sach', long: 'Sacharja', usfm: 'ZEC' },
  { osis: 'Mal', short: 'Mal', long: 'Maleachi', usfm: 'MAL' },
  // Gospels & Acts
  { osis: 'Matt', short: 'Mt', long: 'Matthäus', usfm: 'MAT' },
  { osis: 'Mark', short: 'Mk', long: 'Markus', usfm: 'MRK' },
  { osis: 'Luke', short: 'Lk', long: 'Lukas', usfm: 'LUK' },
  { osis: 'John', short: 'Joh', long: 'Johannes', usfm: 'JHN' },
  { osis: 'Acts', short: 'Apg', long: 'Apostelgeschichte', usfm: 'ACT' },
  // Pauline epistles
  { osis: 'Rom', short: 'Röm', long: 'Römer', usfm: 'ROM' },
  { osis: '1Cor', short: '1 Kor', long: '1. Korinther', usfm: '1CO' },
  { osis: '2Cor', short: '2 Kor', long: '2. Korinther', usfm: '2CO' },
  { osis: 'Gal', short: 'Gal', long: 'Galater', usfm: 'GAL' },
  { osis: 'Eph', short: 'Eph', long: 'Epheser', usfm: 'EPH' },
  { osis: 'Phil', short: 'Phil', long: 'Philipper', usfm: 'PHP' },
  { osis: 'Col', short: 'Kol', long: 'Kolosser', usfm: 'COL' },
  { osis: '1Thess', short: '1 Thess', long: '1. Thessalonicher', usfm: '1TH' },
  { osis: '2Thess', short: '2 Thess', long: '2. Thessalonicher', usfm: '2TH' },
  { osis: '1Tim', short: '1 Tim', long: '1. Timotheus', usfm: '1TI' },
  { osis: '2Tim', short: '2 Tim', long: '2. Timotheus', usfm: '2TI' },
  { osis: 'Titus', short: 'Tit', long: 'Titus', usfm: 'TIT' },
  { osis: 'Phlm', short: 'Phlm', long: 'Philemon', usfm: 'PHM' },
  // General epistles
  { osis: 'Heb', short: 'Hebr', long: 'Hebräer', usfm: 'HEB' },
  { osis: 'Jas', short: 'Jak', long: 'Jakobus', usfm: 'JAS' },
  { osis: '1Pet', short: '1 Petr', long: '1. Petrus', usfm: '1PE' },
  { osis: '2Pet', short: '2 Petr', long: '2. Petrus', usfm: '2PE' },
  { osis: '1John', short: '1 Joh', long: '1. Johannes', usfm: '1JN' },
  { osis: '2John', short: '2 Joh', long: '2. Johannes', usfm: '2JN' },
  { osis: '3John', short: '3 Joh', long: '3. Johannes', usfm: '3JN' },
  { osis: 'Jude', short: 'Jud', long: 'Judas', usfm: 'JUD' },
  // Apocalypse
  { osis: 'Rev', short: 'Offb', long: 'Offenbarung', usfm: 'REV' },
  // Common deutero-canonicals (used in some German bibles)
  { osis: 'Tob', short: 'Tob', long: 'Tobit', usfm: 'TOB' },
  { osis: 'Jdt', short: 'Jdt', long: 'Judit', usfm: 'JDT' },
  { osis: 'Wis', short: 'Weish', long: 'Weisheit', usfm: 'WIS' },
  { osis: 'Sir', short: 'Sir', long: 'Sirach', usfm: 'SIR' },
  { osis: 'Bar', short: 'Bar', long: 'Baruch', usfm: 'BAR' },
  { osis: '1Macc', short: '1 Makk', long: '1. Makkabäer', usfm: '1MA' },
  { osis: '2Macc', short: '2 Makk', long: '2. Makkabäer', usfm: '2MA' }
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
  if (sb === eb && sc !== ec && !sv && !ev) {
    // whole-chapter range: "Apg 1-2"
    return `${sBook} ${sc}-${ec}`;
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

/** Base URL for die-bibel.de Lutherbibel 2017 deep links. */
const DIE_BIBEL_BASE = 'https://www.die-bibel.de/bibel/LU17';

/**
 * Lookup key for a book name: accent-folded, lowercased, with every dot and
 * whitespace removed — so "1. Kor.", "1 Kor" and "1Kor" all become "1kor",
 * and "Mk." equals "Mk".
 *
 * @param {string} name
 * @returns {string}
 */
function bookKey(name) {
  return fold(name).replace(/[.\s]/g, '');
}

/**
 * Spellings found in published `ext:ekw:bibleReference` tags that are neither
 * the table's short nor long form: ecumenical (Loccum) Pentateuch names and
 * the Psalter plural.
 *
 * @type {Record<string, string>}
 */
const BOOK_ALIASES = {
  Gen: 'GEN',
  Ex: 'EXO',
  Lev: 'LEV',
  Num: 'NUM',
  Dtn: 'DEU',
  Psalmen: 'PSA'
};

/** @type {Map<string, string>} book key → USFM code */
const USFM_BY_BOOK_KEY = new Map([
  ...BOOKS_TABLE.flatMap((b) => [
    /** @type {[string, string]} */ ([bookKey(b.short), b.usfm]),
    /** @type {[string, string]} */ ([bookKey(b.long), b.usfm])
  ]),
  ...Object.entries(BOOK_ALIASES).map(
    ([name, usfm]) => /** @type {[string, string]} */ ([bookKey(name), usfm])
  )
]);

/**
 * Book token, then the chapter/verse part. The book is an optional ordinal
 * ("1", "1.") plus one word with an optional abbreviation dot; the rest must
 * start with a digit.
 */
const REFERENCE_RE = /^((?:[1-5]\.?\s*)?\p{L}+)\.?\s*(\d.*)$/u;

/**
 * Build a die-bibel.de deep link for a German bible reference (e.g.
 * `"Mt 5,3-12"`). Targets the Lutherbibel 2017 (`LU17`).
 *
 * die-bibel.de uses USFM 3-letter book codes in the URL path
 * (`/LU17/MAT.5.3-12`). Unknown book codes silently fall back to Genesis 1
 * rather than 404, so this builder explicitly maps each known German book
 * name to its USFM code — never passes the German string through.
 *
 * Tolerates the spellings found in published events: short or long book
 * names with or without abbreviation dot ("Mk. 1,16-20", "Markus 1,16"),
 * ordinals with or without dot ("1. Kor 12", "1 Kor 12"), en dashes,
 * spaces around the dash, "f."/"ff." and a/b verse-part suffixes.
 * Free text that doesn't start with a known book plus a digit stays unlinked.
 *
 * Limitations (die-bibel.de can't express these in the URL):
 *  - Chapter ranges (`Apg 1-2`) and cross-chapter ranges (`Hes 1,1-3,15`)
 *    link to their start chapter / start verse.
 *  - Verse lists (`Jer 29,7.11-14`) and "ff." link to the first verse.
 *  - `;`-separated multi-refs in a single entry only link the first ref;
 *    the text shows the rest as plain text.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function toDieBibelUrl(text) {
  // Multi-ref entry like "Mt 5,3-12; Lk 6,20-26" → only link the first ref.
  const first = (text || '').split(';')[0].trim();
  const m = REFERENCE_RE.exec(first);
  if (!m) return null;

  const usfm = USFM_BY_BOOK_KEY.get(bookKey(m[1]));
  if (!usfm) return null;

  const rest = m[2]
    .replace(/[\u2010-\u2015]/g, '-') // en/em dashes → hyphen
    .replace(/\s+/g, '')
    .replace(/(\d)[a-c](?=$|[-.])/g, '$1'); // "31a" → "31"
  const url = (/** @type {string} */ path) => `${DIE_BIBEL_BASE}/${usfm}.${path}`;

  // Chapter or chapter range — "Ps 23", "Apg 1-2" (range → start chapter)
  const mChapter = /^(\d+)(?:-\d+)?$/.exec(rest);
  if (mChapter) return url(mChapter[1]);

  // "Mt 13,31f." = verses 31-32; "Mt 5,3ff." → start verse
  const mFollowing = /^(\d+),(\d+)(f|ff)\.?$/.exec(rest);
  if (mFollowing) {
    const [, c, v, f] = mFollowing;
    return url(f === 'f' ? `${c}.${v}-${Number(v) + 1}` : `${c}.${v}`);
  }

  // Verse, verse range, cross-chapter range or verse list —
  // "Joh 3,16", "Mt 5,3-12", "Hes 1,1-3,15", "Jer 29,7.11-14"
  const mVerse = /^(\d+),(\d+)(?:-(\d+)(,\d+)?|(?:\.\d+(?:-\d+)?)+)?$/.exec(rest);
  if (mVerse) {
    const [, c, v, end, crossChapter] = mVerse;
    if (end && !crossChapter) return url(`${c}.${v}-${end}`);
    return url(`${c}.${v}`);
  }

  return null;
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
