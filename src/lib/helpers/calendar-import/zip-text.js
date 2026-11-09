// Minimal ZIP reader for the small Office/ODF documents Termi's calendar
// import accepts (docx/xlsx/odt/ods). Walks the central directory from the
// end-of-central-directory record; supports store (method 0) and deflate
// (method 8) entries via DecompressionStream. zip64 and streamed
// (data-descriptor) entries are skipped — none of the supported formats
// produce them for documents this small.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

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
 * @param {Uint8Array} compressed
 * @returns {Promise<Uint8Array>}
 */
async function inflateRaw(compressed) {
  const stream = new Blob([compressed.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * @param {Uint8Array} bytes whole-file bytes
 * @param {DataView} view same buffer, for multi-byte reads
 * @param {number} localHeaderOffset
 * @param {number} method
 * @param {number} compressedSize
 * @returns {Promise<Uint8Array>}
 */
async function readLocalEntry(bytes, view, localHeaderOffset, method, compressedSize) {
  if (view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('Corrupt zip local header');
  }
  const nameLen = view.getUint16(localHeaderOffset + 26, true);
  const extraLen = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
  return method === 0 ? new Uint8Array(compressed) : inflateRaw(compressed);
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

    if (!isZip64 && !hasDataDescriptor && !isDirectory && (method === 0 || method === 8)) {
      entries.set(
        name,
        await readLocalEntry(bytes, view, localHeaderOffset, method, compressedSize)
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

/** @param {string} xml */
function docxToText(xml) {
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs
    .map((p) => {
      const texts = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) =>
        decodeEntities(m[1])
      );
      return texts.join('');
    })
    .join('\n');
}

/** @param {string} xml sharedStrings.xml content */
function parseSharedStrings(xml) {
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) ?? [];
  return items.map((si) => {
    const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1]));
    return texts.join('');
  });
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
  if (type === 'inlineStr') {
    const texts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1]));
    return texts.join('');
  }
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
      return cells
        .map(([, attrs, inner]) => parseCellValue(attrs, inner, sharedStrings))
        .join('\t');
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

/** @param {string} xml ODF content.xml */
function odfToText(xml) {
  const lines = [];
  const blockRe =
    /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>|<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g;
  let match;
  while ((match = blockRe.exec(xml))) {
    const [, rowInner, paragraphInner] = match;
    if (rowInner !== undefined) {
      const cells = [
        ...rowInner.matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)
      ];
      const cellTexts = cells.map(([, cellInner]) => {
        const texts = [...cellInner.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((m) =>
          decodeEntities(m[1])
        );
        return texts.join(' ');
      });
      lines.push(cellTexts.join('\t'));
    } else {
      lines.push(decodeEntities(paragraphInner));
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
