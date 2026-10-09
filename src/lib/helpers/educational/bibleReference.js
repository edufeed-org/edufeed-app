/**
 * Bible reference parsing, normalization and linking.
 *
 * House style (laoc, 2026-10-07): the Loccum guidelines — Deutsche
 * Bibelgesellschaft / Katholisches Bibelwerk (Hg.), "Ökumenisches Verzeichnis
 * der biblischen Eigennamen nach den Loccumer Richtlinien", Stuttgart ²1981
 * (abbreviation list in the appendix; the abbreviations of the
 * Einheitsübersetzung). Citation rules as taught e.g. in the Uni Passau KTF
 * handout "Einführung in das wissenschaftliche Arbeiten", §4.1 + §8.2:
 *
 *  - book abbreviation without a dot; numbered books "1 Kor", "2 Tim";
 *  - "Gen 1,1" — no space after the comma;
 *  - chapter range "Gen 1-3", verse range "Gen 1,1-17", across chapters
 *    "Gen 3,17-4,12" — hyphen, no spaces;
 *  - single verses of one chapter joined by "." — "Gen 1,1.3.5.7";
 *  - several passages joined by "; ", the book named once —
 *    "Gen 1,1.3; 3,17-21; Ex 15,3".
 *
 * Every other spelling (Luther abbreviations "1 Mo"/"Hi"/"Pred"/"Hes",
 * dotted "Mk.", full German names, OSIS / English names) is accepted as input
 * and normalized to that form.
 *
 * `parseAndCanonicalize` uses `bible-passage-reference-parser` (MIT), loaded
 * via dynamic import so the ~150 KB bundle only lands on routes that need it
 * (the EKW resource form). `normalizeBibleReference` and `toDieBibelUrl` are
 * synchronous and parser-free, for display.
 */

/**
 * Canonical book table — single source of truth for OSIS ↔ Loccum
 * abbreviation (`abbr`), German name (`name`, typeahead), USFM code
 * (die-bibel.de deep links) and accepted input spellings: German ones
 * (`aliases`, also offered by the typeahead) and OSIS / English ones (`intl`,
 * accepted on input only — so typing "Mark" still suggests "Markus").
 * `abbr` follows the Loccum list; where sources disagree: "Zef" (the
 * Einheitsübersetzung's spelling; the old "Zeph" is an alias) and "Joël"
 * ("Joel" accepted).
 *
 * @typedef {{ osis: string, abbr: string, name: string, usfm: string, aliases: string[], intl: string[] }} BibleBook
 * @type {ReadonlyArray<Readonly<BibleBook>>}
 */
export const LOCCUM_BIBLE_BOOKS = Object.freeze(
  /** @type {BibleBook[]} */ ([
    // Pentateuch
    {
      osis: 'Gen',
      abbr: 'Gen',
      name: 'Genesis',
      usfm: 'GEN',
      aliases: ['1 Mo', '1. Mose'],
      intl: []
    },
    {
      osis: 'Exod',
      abbr: 'Ex',
      name: 'Exodus',
      usfm: 'EXO',
      aliases: ['2 Mo', '2. Mose'],
      intl: ['Exod']
    },
    {
      osis: 'Lev',
      abbr: 'Lev',
      name: 'Levitikus',
      usfm: 'LEV',
      aliases: ['3 Mo', '3. Mose'],
      intl: ['Leviticus']
    },
    {
      osis: 'Num',
      abbr: 'Num',
      name: 'Numeri',
      usfm: 'NUM',
      aliases: ['4 Mo', '4. Mose'],
      intl: ['Numbers']
    },
    {
      osis: 'Deut',
      abbr: 'Dtn',
      name: 'Deuteronomium',
      usfm: 'DEU',
      aliases: ['5 Mo', '5. Mose'],
      intl: ['Deut', 'Deuteronomy']
    },
    // Historical books
    {
      osis: 'Josh',
      abbr: 'Jos',
      name: 'Josua',
      usfm: 'JOS',
      aliases: [],
      intl: ['Josh', 'Joshua']
    },
    {
      osis: 'Judg',
      abbr: 'Ri',
      name: 'Richter',
      usfm: 'JDG',
      aliases: [],
      intl: ['Judg', 'Judges']
    },
    { osis: 'Ruth', abbr: 'Rut', name: 'Rut', usfm: 'RUT', aliases: [], intl: ['Ruth'] },
    { osis: '1Sam', abbr: '1 Sam', name: '1. Samuel', usfm: '1SA', aliases: [], intl: ['1Sam'] },
    { osis: '2Sam', abbr: '2 Sam', name: '2. Samuel', usfm: '2SA', aliases: [], intl: ['2Sam'] },
    {
      osis: '1Kgs',
      abbr: '1 Kön',
      name: '1. Könige',
      usfm: '1KI',
      aliases: [],
      intl: ['1Kgs', '1 Kings']
    },
    {
      osis: '2Kgs',
      abbr: '2 Kön',
      name: '2. Könige',
      usfm: '2KI',
      aliases: [],
      intl: ['2Kgs', '2 Kings']
    },
    {
      osis: '1Chr',
      abbr: '1 Chr',
      name: '1. Chronik',
      usfm: '1CH',
      aliases: [],
      intl: ['1 Chronicles']
    },
    {
      osis: '2Chr',
      abbr: '2 Chr',
      name: '2. Chronik',
      usfm: '2CH',
      aliases: [],
      intl: ['2 Chronicles']
    },
    { osis: 'Ezra', abbr: 'Esra', name: 'Esra', usfm: 'EZR', aliases: ['Esr'], intl: ['Ezra'] },
    { osis: 'Neh', abbr: 'Neh', name: 'Nehemia', usfm: 'NEH', aliases: [], intl: ['Nehemiah'] },
    {
      osis: 'Esth',
      abbr: 'Est',
      name: 'Ester',
      usfm: 'EST',
      aliases: [],
      intl: ['Esth', 'Esther']
    },
    // Wisdom & poetry
    {
      osis: 'Job',
      abbr: 'Ijob',
      name: 'Ijob',
      usfm: 'JOB',
      aliases: ['Hi', 'Hiob'],
      intl: ['Job']
    },
    { osis: 'Ps', abbr: 'Ps', name: 'Psalmen', usfm: 'PSA', aliases: ['Psalm'], intl: ['Psalms'] },
    {
      osis: 'Prov',
      abbr: 'Spr',
      name: 'Sprüche',
      usfm: 'PRO',
      aliases: ['Sprichwörter'],
      intl: ['Prov', 'Proverbs']
    },
    {
      osis: 'Eccl',
      abbr: 'Koh',
      name: 'Kohelet',
      usfm: 'ECC',
      aliases: ['Pred', 'Prediger'],
      intl: ['Eccl', 'Ecclesiastes']
    },
    {
      osis: 'Song',
      abbr: 'Hld',
      name: 'Hoheslied',
      usfm: 'SNG',
      aliases: ['Hohelied'],
      intl: ['Song']
    },
    // Major prophets
    { osis: 'Isa', abbr: 'Jes', name: 'Jesaja', usfm: 'ISA', aliases: [], intl: ['Isa', 'Isaiah'] },
    { osis: 'Jer', abbr: 'Jer', name: 'Jeremia', usfm: 'JER', aliases: [], intl: ['Jeremiah'] },
    {
      osis: 'Lam',
      abbr: 'Klgl',
      name: 'Klagelieder',
      usfm: 'LAM',
      aliases: [],
      intl: ['Lam', 'Lamentations']
    },
    {
      osis: 'Ezek',
      abbr: 'Ez',
      name: 'Ezechiel',
      usfm: 'EZK',
      aliases: ['Hes', 'Hesekiel'],
      intl: ['Ezek', 'Ezekiel']
    },
    { osis: 'Dan', abbr: 'Dan', name: 'Daniel', usfm: 'DAN', aliases: [], intl: [] },
    // Minor prophets
    { osis: 'Hos', abbr: 'Hos', name: 'Hosea', usfm: 'HOS', aliases: [], intl: [] },
    { osis: 'Joel', abbr: 'Joël', name: 'Joël', usfm: 'JOL', aliases: ['Joel'], intl: [] },
    { osis: 'Amos', abbr: 'Am', name: 'Amos', usfm: 'AMO', aliases: [], intl: [] },
    {
      osis: 'Obad',
      abbr: 'Obd',
      name: 'Obadja',
      usfm: 'OBA',
      aliases: [],
      intl: ['Obad', 'Obadiah']
    },
    { osis: 'Jonah', abbr: 'Jona', name: 'Jona', usfm: 'JON', aliases: [], intl: ['Jonah'] },
    { osis: 'Mic', abbr: 'Mi', name: 'Micha', usfm: 'MIC', aliases: [], intl: ['Mic', 'Micah'] },
    { osis: 'Nah', abbr: 'Nah', name: 'Nahum', usfm: 'NAM', aliases: [], intl: [] },
    { osis: 'Hab', abbr: 'Hab', name: 'Habakuk', usfm: 'HAB', aliases: [], intl: ['Habakkuk'] },
    {
      osis: 'Zeph',
      abbr: 'Zef',
      name: 'Zefanja',
      usfm: 'ZEP',
      aliases: ['Zeph', 'Zephanja'],
      intl: ['Zephaniah']
    },
    { osis: 'Hag', abbr: 'Hag', name: 'Haggai', usfm: 'HAG', aliases: [], intl: [] },
    {
      osis: 'Zech',
      abbr: 'Sach',
      name: 'Sacharja',
      usfm: 'ZEC',
      aliases: [],
      intl: ['Zech', 'Zechariah']
    },
    { osis: 'Mal', abbr: 'Mal', name: 'Maleachi', usfm: 'MAL', aliases: [], intl: ['Malachi'] },
    // Gospels & Acts
    {
      osis: 'Matt',
      abbr: 'Mt',
      name: 'Matthäus',
      usfm: 'MAT',
      aliases: ['Matthäusevangelium'],
      intl: ['Matt', 'Matthew']
    },
    {
      osis: 'Mark',
      abbr: 'Mk',
      name: 'Markus',
      usfm: 'MRK',
      aliases: ['Markusevangelium'],
      intl: ['Mark']
    },
    {
      osis: 'Luke',
      abbr: 'Lk',
      name: 'Lukas',
      usfm: 'LUK',
      aliases: ['Lukasevangelium'],
      intl: ['Luke']
    },
    {
      osis: 'John',
      abbr: 'Joh',
      name: 'Johannes',
      usfm: 'JHN',
      aliases: ['Johannesevangelium'],
      intl: ['John']
    },
    {
      osis: 'Acts',
      abbr: 'Apg',
      name: 'Apostelgeschichte',
      usfm: 'ACT',
      aliases: [],
      intl: ['Acts']
    },
    // Pauline epistles
    {
      osis: 'Rom',
      abbr: 'Röm',
      name: 'Römer',
      usfm: 'ROM',
      aliases: ['Römerbrief'],
      intl: ['Rom', 'Romans']
    },
    {
      osis: '1Cor',
      abbr: '1 Kor',
      name: '1. Korinther',
      usfm: '1CO',
      aliases: [],
      intl: ['1Cor', '1 Corinthians']
    },
    {
      osis: '2Cor',
      abbr: '2 Kor',
      name: '2. Korinther',
      usfm: '2CO',
      aliases: [],
      intl: ['2Cor', '2 Corinthians']
    },
    { osis: 'Gal', abbr: 'Gal', name: 'Galater', usfm: 'GAL', aliases: [], intl: ['Galatians'] },
    { osis: 'Eph', abbr: 'Eph', name: 'Epheser', usfm: 'EPH', aliases: [], intl: ['Ephesians'] },
    {
      osis: 'Phil',
      abbr: 'Phil',
      name: 'Philipper',
      usfm: 'PHP',
      aliases: [],
      intl: ['Philippians']
    },
    {
      osis: 'Col',
      abbr: 'Kol',
      name: 'Kolosser',
      usfm: 'COL',
      aliases: [],
      intl: ['Col', 'Colossians']
    },
    {
      osis: '1Thess',
      abbr: '1 Thess',
      name: '1. Thessalonicher',
      usfm: '1TH',
      aliases: [],
      intl: ['1 Thessalonians']
    },
    {
      osis: '2Thess',
      abbr: '2 Thess',
      name: '2. Thessalonicher',
      usfm: '2TH',
      aliases: [],
      intl: ['2 Thessalonians']
    },
    {
      osis: '1Tim',
      abbr: '1 Tim',
      name: '1. Timotheus',
      usfm: '1TI',
      aliases: [],
      intl: ['1 Timothy']
    },
    {
      osis: '2Tim',
      abbr: '2 Tim',
      name: '2. Timotheus',
      usfm: '2TI',
      aliases: [],
      intl: ['2 Timothy']
    },
    { osis: 'Titus', abbr: 'Tit', name: 'Titus', usfm: 'TIT', aliases: [], intl: [] },
    { osis: 'Phlm', abbr: 'Phlm', name: 'Philemon', usfm: 'PHM', aliases: [], intl: [] },
    // General epistles
    {
      osis: 'Heb',
      abbr: 'Hebr',
      name: 'Hebräer',
      usfm: 'HEB',
      aliases: [],
      intl: ['Heb', 'Hebrews']
    },
    { osis: 'Jas', abbr: 'Jak', name: 'Jakobus', usfm: 'JAS', aliases: [], intl: ['Jas', 'James'] },
    {
      osis: '1Pet',
      abbr: '1 Petr',
      name: '1. Petrus',
      usfm: '1PE',
      aliases: [],
      intl: ['1Pet', '1 Peter']
    },
    {
      osis: '2Pet',
      abbr: '2 Petr',
      name: '2. Petrus',
      usfm: '2PE',
      aliases: [],
      intl: ['2Pet', '2 Peter']
    },
    {
      osis: '1John',
      abbr: '1 Joh',
      name: '1. Johannes',
      usfm: '1JN',
      aliases: [],
      intl: ['1John']
    },
    {
      osis: '2John',
      abbr: '2 Joh',
      name: '2. Johannes',
      usfm: '2JN',
      aliases: [],
      intl: ['2John']
    },
    {
      osis: '3John',
      abbr: '3 Joh',
      name: '3. Johannes',
      usfm: '3JN',
      aliases: [],
      intl: ['3John']
    },
    { osis: 'Jude', abbr: 'Jud', name: 'Judas', usfm: 'JUD', aliases: [], intl: ['Jude'] },
    // Apocalypse
    {
      osis: 'Rev',
      abbr: 'Offb',
      name: 'Offenbarung',
      usfm: 'REV',
      aliases: ['Apokalypse'],
      intl: ['Rev', 'Revelation']
    },
    // Deutero-canonicals
    { osis: 'Tob', abbr: 'Tob', name: 'Tobit', usfm: 'TOB', aliases: [], intl: [] },
    { osis: 'Jdt', abbr: 'Jdt', name: 'Judit', usfm: 'JDT', aliases: [], intl: ['Judith'] },
    {
      osis: 'Wis',
      abbr: 'Weish',
      name: 'Weisheit',
      usfm: 'WIS',
      aliases: [],
      intl: ['Wis', 'Wisdom']
    },
    { osis: 'Sir', abbr: 'Sir', name: 'Sirach', usfm: 'SIR', aliases: [], intl: [] },
    { osis: 'Bar', abbr: 'Bar', name: 'Baruch', usfm: 'BAR', aliases: [], intl: [] },
    {
      osis: '1Macc',
      abbr: '1 Makk',
      name: '1. Makkabäer',
      usfm: '1MA',
      aliases: [],
      intl: ['1Macc', '1 Maccabees']
    },
    {
      osis: '2Macc',
      abbr: '2 Makk',
      name: '2. Makkabäer',
      usfm: '2MA',
      aliases: [],
      intl: ['2Macc', '2 Maccabees']
    }
  ]).map((b) => Object.freeze(b))
);

/** @type {Record<string, string>} */
const OSIS_TO_ABBR = Object.fromEntries(LOCCUM_BIBLE_BOOKS.map((b) => [b.osis, b.abbr]));

/**
 * Typeahead entries in canonical (biblical) order: Loccum abbreviation
 * (`short`), German name (`long`) and the other accepted spellings.
 *
 * @type {ReadonlyArray<{ short: string, long: string, aliases: string[] }>}
 */
export const BIBLE_BOOKS = Object.freeze(
  LOCCUM_BIBLE_BOOKS.map(({ abbr, name, aliases }) =>
    Object.freeze({ short: abbr, long: name, aliases })
  )
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
 * Lookup key for a book name: accent-folded, lowercased, with every dot and
 * whitespace removed — so "1. Kor.", "1 Kor" and "1Kor" all become "1kor",
 * "Mk." equals "Mk" and "Joel" equals "Joël".
 *
 * @param {string} name
 * @returns {string}
 */
function bookKey(name) {
  return fold(name).replace(/[.\s]/g, '');
}

/** @type {Map<string, Readonly<BibleBook>>} book key → book */
const BOOK_BY_KEY = new Map(
  LOCCUM_BIBLE_BOOKS.flatMap((b) =>
    [b.abbr, b.name, ...b.aliases, b.osis, ...b.intl].map(
      (n) => /** @type {const} */ ([bookKey(n), b])
    )
  )
);

/**
 * Find books whose abbreviation, name or alias contains `query`
 * (accent-insensitive) — so "Mose" finds Gen…Dtn and "Hiob" finds Ijob.
 * Prefix matches are ranked first.
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<(typeof BIBLE_BOOKS)[number]>}
 */
export function findBookMatches(query, limit = 8) {
  const q = fold(query.trim());
  if (!q) return [];
  /** @type {Array<(typeof BIBLE_BOOKS)[number]>} */
  const prefix = [];
  /** @type {Array<(typeof BIBLE_BOOKS)[number]>} */
  const contains = [];
  for (const b of BIBLE_BOOKS) {
    const names = [b.short, b.long, ...b.aliases].map(fold);
    if (names.some((n) => n.startsWith(q))) prefix.push(b);
    else if (names.some((n) => n.includes(q))) contains.push(b);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/**
 * If the input is exactly a known book name in any accepted spelling
 * (ignoring case, accents, dots and spaces), return that entry — used to give
 * a "Kapitel ergänzen" hint instead of an "unparseable" warning when the user
 * has just typed a book name without a chapter yet.
 *
 * @param {string} query
 * @returns {(typeof BIBLE_BOOKS)[number] | null}
 */
export function findExactBook(query) {
  const key = bookKey(query.trim());
  if (!key) return null;
  return (
    BIBLE_BOOKS.find((b) => [b.short, b.long, ...b.aliases].some((n) => bookKey(n) === key)) ?? null
  );
}

/**
 * @typedef {Object} LoccumPart
 * @property {string} book  Loccum abbreviation (or OSIS code if unmapped)
 * @property {string} chapter
 * @property {string} passage  "1,1-17", "1-3", "3,17-4,12", "14"
 * @property {string | null} verses  "1" / "1-17" when the part stays inside one chapter
 * @property {string | null} crossBook  full text for a range spanning books
 */

/**
 * Split a single OSIS entity ("Matt.5.3-Matt.5.12") into Loccum pieces.
 *
 * @param {string} osisEntity
 * @returns {LoccumPart}
 */
function formatOne(osisEntity) {
  const [start, end] = osisEntity.split('-');
  const [sb, sc, sv] = start.split('.');
  const book = OSIS_TO_ABBR[sb] ?? sb;
  /** @param {string} passage @param {string | null} verses @returns {LoccumPart} */
  const part = (passage, verses) => ({ book, chapter: sc, passage, verses, crossBook: null });

  if (!end) return sv ? part(`${sc},${sv}`, sv) : part(sc, null);

  const [eb, ec, ev] = end.split('.');
  if (sb === eb && sc === ec && sv && ev) return part(`${sc},${sv}-${ev}`, `${sv}-${ev}`); // "Gen 1,1-17"
  if (sb === eb && sc !== ec && !sv && !ev) return part(`${sc}-${ec}`, null); // "Gen 1-3"
  if (sb === eb) return part(`${sc},${sv ?? '1'}-${ec},${ev ?? '1'}`, null); // "Gen 3,17-4,12"
  // cross-book (rare in everyday use)
  const eBook = OSIS_TO_ABBR[eb] ?? eb;
  return {
    ...part('', null),
    crossBook: `${book} ${sc}${sv ? ',' + sv : ''}-${eBook} ${ec}${ev ? ',' + ev : ''}`
  };
}

/**
 * Convert a full OSIS string (comma-separated entities) to the Loccum form:
 * passages joined by "; " with the book named once, single verses of the
 * same chapter joined by "." — "Gen 1,1.3; 3,17-21; Ex 15,3".
 *
 * @param {string} osis
 * @returns {string}
 */
function osisToLoccum(osis) {
  let out = '';
  /** @type {LoccumPart | null} */
  let prev = null;
  for (const entity of osis
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const p = formatOne(entity);
    if (p.crossBook) {
      out += (out ? '; ' : '') + p.crossBook;
      prev = null;
    } else if (
      prev &&
      prev.book === p.book &&
      prev.chapter === p.chapter &&
      prev.verses &&
      p.verses
    ) {
      out += `.${p.verses}`;
    } else if (prev && prev.book === p.book) {
      out += `; ${p.passage}`;
    } else {
      out += `${out ? '; ' : ''}${p.book} ${p.passage}`;
    }
    if (!p.crossBook) prev = p;
  }
  return out;
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
      // 'ona': include the deutero-canonical books (Tob, Sir, 1 Makk, …).
      parser.set_options({ punctuation_strategy: 'eu', testaments: 'ona' });
      return { parser };
    })();
  }
  return parserPromise;
}

/**
 * @typedef {Object} BibleReferenceResult
 * @property {boolean} ok - whether the input parsed to a real reference
 * @property {string | null} canonical - Loccum form (e.g. "Mt 5,3-12") when ok
 * @property {string | null} osis - canonical OSIS string when ok
 */

/** Base URL for die-bibel.de Lutherbibel 2017 deep links. */
const DIE_BIBEL_BASE = 'https://www.die-bibel.de/bibel/LU17';

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
 *  - Chapter ranges (`Apg 1-2`) and cross-chapter ranges (`Ez 1,1-3,15`)
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
  const first = (text || '').normalize('NFC').split(';')[0].trim();
  const m = REFERENCE_RE.exec(first);
  if (!m) return null;

  const usfm = BOOK_BY_KEY.get(bookKey(m[1]))?.usfm;
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

  // Verse, verse range, cross-chapter range or verse list — "Joh 3,16",
  // "Mt 5,3-12", "Ez 1,1-3,15", "Jer 29,7.11-14", "Mt 5,3-12.14" (a list
  // that opens with a range links to that range)
  const mVerse = /^(\d+),(\d+)(?:-(\d+)(,\d+)?)?(?:\.\d+(?:-\d+)?)*$/.exec(rest);
  if (mVerse) {
    const [, c, v, end, crossChapter] = mVerse;
    if (end && !crossChapter) return url(`${c}.${v}-${end}`);
    return url(`${c}.${v}`);
  }

  return null;
}

/** Chapter/verse part after cleanup: "14", "1-2", "1,16-20", "29,7.11-14a", "13,31f." */
const PASSAGE_RE = /^\d+(?:[,.-]\d+[a-c]?)*(?:ff?\.?)?$/;

/**
 * Rewrite a stored or imported reference into the Loccum form,
 * synchronously and without the parser bundle: "Mk. 1,16-20" → "Mk 1,16-20",
 * "Psalm 104" → "Ps 104", "1. Mose 2,4-7" → "Gen 2,4-7", "Hiob 1,21" →
 * "Ijob 1,21". Only the book name is rewritten and repeated book names in a
 * "; " list are dropped ("Mt 5,3; Mt 6,1" → "Mt 5,3; 6,1"); the chapter/verse
 * part keeps its content with dashes and spacing tidied ("1,16 – 20" →
 * "1,16-20"). Anything not recognized as a reference — including a list with
 * one unrecognized entry — is returned verbatim.
 *
 * Used for display and for enrichment prefill; stored events are never
 * rewritten.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeBibleReference(text) {
  if (typeof text !== 'string') return text;
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} */
  let prevBook = null;
  for (const part of text
    .normalize('NFC')
    .split(';')
    .map((p) => p.trim())) {
    const m = REFERENCE_RE.exec(part);
    const book = m && BOOK_BY_KEY.get(bookKey(m[1]));
    // A bare "3,17-21" continues the previous entry's book (Loccum list form).
    const passage = (book ? m[2] : prevBook ? part : '')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/\s+/g, '');
    if (!PASSAGE_RE.test(passage)) return text;
    /** @type {string | null} */
    const abbr = book ? book.abbr : prevBook;
    out.push(abbr === prevBook ? passage : `${abbr} ${passage}`);
    prevBook = abbr;
  }
  return out.join('; ');
}

/**
 * Parse a free-text bible reference and return its canonical Loccum form.
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
  // The parser's German data spells "Joel" without the diaeresis of "Joël".
  parser.parse(
    trimmed
      .normalize('NFD')
      .replace(/e\u0308/g, 'e')
      .normalize('NFC')
  );
  const osis = parser.osis();
  if (!osis) {
    return { ok: false, canonical: null, osis: null };
  }
  return { ok: true, canonical: osisToLoccum(osis), osis };
}
