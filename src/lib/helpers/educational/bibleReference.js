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
 * OSIS book code → canonical German short form.
 * Source: standard German Bible (Loccumer Richtlinien) abbreviations.
 * Covers all 66 protestant books + a few deutero-canonicals the parser knows.
 *
 * @type {Record<string, string>}
 */
const OSIS_TO_DE = {
  // Pentateuch
  Gen: '1 Mo',
  Exod: '2 Mo',
  Lev: '3 Mo',
  Num: '4 Mo',
  Deut: '5 Mo',
  // Historical books
  Josh: 'Jos',
  Judg: 'Ri',
  Ruth: 'Rut',
  '1Sam': '1 Sam',
  '2Sam': '2 Sam',
  '1Kgs': '1 Kön',
  '2Kgs': '2 Kön',
  '1Chr': '1 Chr',
  '2Chr': '2 Chr',
  Ezra: 'Esr',
  Neh: 'Neh',
  Esth: 'Est',
  // Wisdom & poetry
  Job: 'Hi',
  Ps: 'Ps',
  Prov: 'Spr',
  Eccl: 'Pred',
  Song: 'Hld',
  // Major prophets
  Isa: 'Jes',
  Jer: 'Jer',
  Lam: 'Klgl',
  Ezek: 'Hes',
  Dan: 'Dan',
  // Minor prophets
  Hos: 'Hos',
  Joel: 'Joel',
  Amos: 'Am',
  Obad: 'Obd',
  Jonah: 'Jona',
  Mic: 'Mi',
  Nah: 'Nah',
  Hab: 'Hab',
  Zeph: 'Zef',
  Hag: 'Hag',
  Zech: 'Sach',
  Mal: 'Mal',
  // Gospels & Acts
  Matt: 'Mt',
  Mark: 'Mk',
  Luke: 'Lk',
  John: 'Joh',
  Acts: 'Apg',
  // Pauline epistles
  Rom: 'Röm',
  '1Cor': '1 Kor',
  '2Cor': '2 Kor',
  Gal: 'Gal',
  Eph: 'Eph',
  Phil: 'Phil',
  Col: 'Kol',
  '1Thess': '1 Thess',
  '2Thess': '2 Thess',
  '1Tim': '1 Tim',
  '2Tim': '2 Tim',
  Titus: 'Tit',
  Phlm: 'Phlm',
  // General epistles
  Heb: 'Hebr',
  Jas: 'Jak',
  '1Pet': '1 Petr',
  '2Pet': '2 Petr',
  '1John': '1 Joh',
  '2John': '2 Joh',
  '3John': '3 Joh',
  Jude: 'Jud',
  // Apocalypse
  Rev: 'Offb',
  // Common deutero-canonicals (used in some German bibles)
  Tob: 'Tob',
  Jdt: 'Jdt',
  Wis: 'Weish',
  Sir: 'Sir',
  Bar: 'Bar',
  '1Macc': '1 Makk',
  '2Macc': '2 Makk'
};

/**
 * German short-form book names in canonical (biblical) order — useful as a
 * `<datalist>` source for free-text Bibelstelle inputs.
 *
 * @type {readonly string[]}
 */
export const BIBLE_BOOKS_DE = Object.freeze(Object.values(OSIS_TO_DE));

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
