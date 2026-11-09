// Minimal ZIP reader for the small Office/ODF documents Termi's calendar
// import accepts (docx/xlsx/odt/ods). Walks the central directory from the
// end-of-central-directory record; supports store (method 0) and deflate
// (method 8) entries via DecompressionStream. zip64 and streamed
// (data-descriptor) entries are skipped — none of the supported formats
// produce them for documents this small. Only entries zipToText actually
// reads are ever decompressed, and each is capped at MAX_ENTRY_BYTES —
// defense against a zip bomb hidden in an unrelated part/sheet.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

/** @param {string} name */
function isRelevantEntryName(name) {
  return (
    name === 'word/document.xml' ||
    name === 'xl/sharedStrings.xml' ||
    name === 'content.xml' ||
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );
}

/**
 * @param {DataView} view
 * @returns {number} offset of the EOCD record, or -1
 */
function findEndOfCentralDirectory(view) {
  const maxCommentLength = 65535;
  const minOffset = Math.max(0, view.byteLength - 22 - maxCommentLength);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * Decompresses a deflate-raw entry, bounded at MAX_ENTRY_BYTES against a zip
 * bomb — both the declared size (cheap, no inflate needed) and the actual
 * decompressed byte count (in case the header understates it).
 * @param {Uint8Array} compressed
 * @param {number} declaredSize
 * @returns {Promise<Uint8Array>}
 */
async function inflateRaw(compressed, declaredSize) {
  if (declaredSize > MAX_ENTRY_BYTES) {
    throw new Error(`Zip entry too large to decompress (${declaredSize} bytes declared)`);
  }
  const stream = new Blob([compressed.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ENTRY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('Zip entry exceeded the decompression size limit');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    buf.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return buf;
}

/**
 * @param {Uint8Array} bytes whole-file bytes
 * @param {DataView} view same buffer, for multi-byte reads
 * @param {number} localHeaderOffset
 * @param {number} method
 * @param {number} compressedSize
 * @param {number} uncompressedSize
 * @returns {Promise<Uint8Array>}
 */
async function readLocalEntry(
  bytes,
  view,
  localHeaderOffset,
  method,
  compressedSize,
  uncompressedSize
) {
  if (view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('Corrupt zip local header');
  }
  const nameLen = view.getUint16(localHeaderOffset + 26, true);
  const extraLen = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
  return method === 0 ? new Uint8Array(compressed) : inflateRaw(compressed, uncompressedSize);
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset === -1) throw new Error('Not a zip file');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);

  /** @type {Map<string, Uint8Array>} */
  const entries = new Map();
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) break;

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    const isZip64 = compressedSize === 0xffffffff || uncompressedSize === 0xffffffff;
    const hasDataDescriptor = (flags & 0x0008) !== 0;
    const isDirectory = name.endsWith('/');

    if (
      !isZip64 &&
      !hasDataDescriptor &&
      !isDirectory &&
      (method === 0 || method === 8) &&
      isRelevantEntryName(name)
    ) {
      entries.set(
        name,
        await readLocalEntry(
          bytes,
          view,
          localHeaderOffset,
          method,
          compressedSize,
          uncompressedSize
        )
      );
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/** @type {Record<string, string>} */
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** @param {string} str */
function decodeEntities(str) {
  return str.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (/** @type {string} */ _, /** @type {string} */ name) => XML_ENTITIES[name]
  );
}

/** @param {Uint8Array} bytes */
function decodeXml(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Joins every `<tagName>…</tagName>` text run in an XML fragment, decoding
 * entities. Used for xlsx shared strings and inline strings (`t`).
 * @param {string} xml
 * @param {string} tagName
 */
function joinT(xml, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  return [...xml.matchAll(re)].map((m) => decodeEntities(m[1])).join('');
}

/**
 * One paragraph's runs, in document order: `<w:t>` text, `<w:tab/>` → tab,
 * `<w:br/>` → newline. The word-boundary-safe `<w:t(?:\s[^>]*)?>` keeps this
 * from also matching `<w:tabs>`/`<w:tab>` the way a plain `<w:t[^>]*>` does
 * (those live in `<w:pPr>` tab-stop definitions, not run content, and must
 * not leak into the text or be read as a run).
 * @param {string} paragraph
 */
function paragraphToText(paragraph) {
  const RUN_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let text = '';
  /** @type {RegExpExecArray | null} */
  let match;
  while ((match = RUN_RE.exec(paragraph))) {
    if (match[1] !== undefined) text += decodeEntities(match[1]);
    else if (match[0].startsWith('<w:tab')) text += '\t';
    else text += '\n';
  }
  return text;
}

/** @param {string} xml */
function docxToText(xml) {
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs.map(paragraphToText).join('\n');
}

/** @param {string} xml sharedStrings.xml content */
function parseSharedStrings(xml) {
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) ?? [];
  return items.map((si) => joinT(si, 't'));
}

/**
 * Column letters ("A", "AA", …) to a 0-based column index.
 * @param {string} ref a cell reference, e.g. "C7"
 */
function columnIndex(ref) {
  const letters = /^([A-Z]+)\d+$/.exec(ref)?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * @param {string} attrs the cell's opening-tag attributes (e.g. ` t="s"`)
 * @param {string | undefined} inner inner XML, undefined for a self-closed `<c/>`
 * @param {string[]} sharedStrings
 */
function parseCellValue(attrs, inner, sharedStrings) {
  const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
  if (inner === undefined) return '';
  if (type === 's') {
    const index = Number(/<v>([^<]*)<\/v>/.exec(inner)?.[1]);
    return sharedStrings[index] ?? '';
  }
  if (type === 'inlineStr') return joinT(inner, 't');
  const value = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
  return value === undefined ? '' : decodeEntities(value);
}

/**
 * @param {string} xml worksheet xml
 * @param {string[]} sharedStrings
 */
function worksheetToText(xml, sharedStrings) {
  const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? [];
  return rows
    .map((row) => {
      const cells = [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)];
      // Cells carry their own column ("r=\"C1\""); a dropped/empty column
      // between two cells must come out as an empty field, not be skipped.
      /** @type {string[]} */
      const values = [];
      let nextIndex = 0;
      for (const [, attrs, inner] of cells) {
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const index = ref ? columnIndex(ref) : -1;
        const safeIndex = index >= 0 ? index : nextIndex;
        values[safeIndex] = parseCellValue(attrs, inner, sharedStrings);
        nextIndex = safeIndex + 1;
      }
      const line = [];
      for (let i = 0; i < values.length; i++) line.push(values[i] ?? '');
      return line.join('\t');
    })
    .join('\n');
}

/** @param {Map<string, Uint8Array>} entries */
function xlsxToText(entries) {
  const sharedStringsBytes = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsBytes ? parseSharedStrings(decodeXml(sharedStringsBytes)) : [];

  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));

  return sheetNames
    .map((name) => {
      const bytes = entries.get(name);
      return bytes ? worksheetToText(decodeXml(bytes), sharedStrings) : '';
    })
    .join('\n\n');
}

/**
 * Replaces the ODF inline markers `<text:tab/>` and `<text:s/>` with their
 * plain-text equivalents, strips any remaining tags (e.g. `<text:span>`),
 * then decodes entities.
 * @param {string} fragment
 */
function odfRunsToText(fragment) {
  return decodeEntities(
    fragment
      .replace(/<text:tab\s*\/>/g, '\t')
      .replace(/<text:s\s*\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
  );
}

// `<text:(p|h)…` with a backreference on the closing tag — not just
// `<text:p`, which would also grab unrelated elements like a hypothetical
// `<text:page-number>` by prefix.
const ODF_PARAGRAPH_RE = /<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\1>/g;

/** @param {string} xml ODF content.xml */
function odfToText(xml) {
  const lines = [];
  const blockRe =
    /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>|<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\2>/g;
  /** @type {RegExpExecArray | null} */
  let match;
  while ((match = blockRe.exec(xml))) {
    const [, rowInner, , paragraphInner] = match;
    if (rowInner !== undefined) {
      const cells = [
        ...rowInner.matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)
      ];
      const cellTexts = cells.map(([, cellInner]) => {
        const paragraphs = [...cellInner.matchAll(ODF_PARAGRAPH_RE)];
        return paragraphs.map((p) => odfRunsToText(p[2])).join(' ');
      });
      lines.push(cellTexts.join('\t'));
    } else {
      lines.push(odfRunsToText(paragraphInner));
    }
  }
  return lines.join('\n');
}

/**
 * @param {Map<string, Uint8Array>} entries
 * @returns {string}
 */
export function zipToText(entries) {
  const document = entries.get('word/document.xml');
  if (document) return docxToText(decodeXml(document));
  const hasWorksheets = [...entries.keys()].some((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );
  if (hasWorksheets) return xlsxToText(entries);
  const content = entries.get('content.xml');
  if (content) return odfToText(decodeXml(content));
  return '';
}
