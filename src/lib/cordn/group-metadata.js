/**
 * Cordn spec/01 — `cordn_group_metadata` MLS GroupContext extension (read
 * side). TLS presentation: uint16 version + five 2-byte-length-prefixed
 * vectors (name, description, admin_pubkeys, icon, image_url). Pure module —
 * no ts-mls dependency.
 */

export const CORDN_GROUP_METADATA_EXTENSION_TYPE = 0xc04d;

const decoder = new TextDecoder();

/** @param {Uint8Array} bytes */
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode a CordnGroupMetadata payload. Returns undefined for malformed
 * encodings, reserved version 0, or invalid admin vectors (spec/01 §4, §9).
 *
 * @param {Uint8Array} bytes
 * @returns {{name: string, description: string, adminPubkeys: string[], icon: string, imageUrl: string} | undefined}
 */
export function decodeGroupMetadata(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2 + 5 * 2) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(0);
  if (version === 0) return undefined;

  /** @type {Uint8Array[]} */
  const vectors = [];
  let offset = 2;
  for (let i = 0; i < 5; i++) {
    if (offset + 2 > bytes.length) return undefined;
    const length = view.getUint16(offset);
    offset += 2;
    if (offset + length > bytes.length) return undefined;
    vectors.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  // Spec §4: ignore unknown trailing fields from future versions.

  const [name, description, adminBytes, icon, imageUrl] = vectors;
  if (adminBytes.length % 32 !== 0) return undefined;
  const adminPubkeys = [];
  for (let i = 0; i < adminBytes.length; i += 32) {
    adminPubkeys.push(bytesToHex(adminBytes.subarray(i, i + 32)));
  }
  try {
    return {
      name: decoder.decode(name),
      description: decoder.decode(description),
      adminPubkeys,
      icon: decoder.decode(icon),
      imageUrl: decoder.decode(imageUrl)
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract and decode the metadata extension from an MLS group state. Accepts
 * any ts-mls ClientState-shaped object; non-matching extension entries
 * (including typed built-ins with structured extensionData) are ignored.
 *
 * @param {any} state
 * @returns {ReturnType<typeof decodeGroupMetadata>}
 */
export function findGroupMetadata(state) {
  const extensions = /** @type {Array<{extensionType: number, extensionData: unknown}>} */ (
    state?.groupContext?.extensions ?? []
  );
  const extension = extensions.find(
    (entry) =>
      entry.extensionType === CORDN_GROUP_METADATA_EXTENSION_TYPE &&
      entry.extensionData instanceof Uint8Array
  );
  return extension
    ? decodeGroupMetadata(/** @type {Uint8Array} */ (extension.extensionData))
    : undefined;
}
