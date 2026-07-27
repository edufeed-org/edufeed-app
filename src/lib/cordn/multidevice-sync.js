/**
 * Cordn multi-device sync — pure protocol pieces for the JOINING-device side
 * (spec/applications/multi-device.md; wire behavior matches cordn-web, which
 * is authoritative where the spec is loose).
 *
 * Model: sealed JSON documents (NIP-44 v2 self-seal under a per-identity DEK
 * keypair) stored as Blossom blobs addressed by sha256 of the sealed text; a
 * kind-30078 replaceable "tip" event signed by an ephemeral key advertises
 * document addresses, the DEK, and Blossom servers inside an owner-signed,
 * owner-self-sealed inner kind-178 event. The connection string carries the
 * tip locator + ephemeral key; possession of it plus the owner signer IS the
 * link handshake.
 */
import { nip19, nip44, getPublicKey } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';

export const TIP_OUTER_KIND = 30078;
export const TIP_INNER_KIND = 178;

/** @param {string} hex */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** @param {Uint8Array} bytes */
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse a cordn-web connection string: base64(JSON {naddr, ephemeralPrivateKey}).
 *
 * @param {string} connection
 * @returns {{ephemeralPubkey: string, dTag: string, relays: string[], ephemeralPrivateKey: string}}
 */
export function parseConnectionString(connection) {
  const parsed = JSON.parse(atob(connection.trim()));
  if (typeof parsed?.naddr !== 'string' || typeof parsed?.ephemeralPrivateKey !== 'string') {
    throw new Error('Ungültiger Verbindungscode');
  }
  const decoded =
    /** @type {{type: string, data: {kind: number, pubkey: string, identifier: string, relays?: string[]}}} */ (
      /** @type {unknown} */ (nip19.decode(parsed.naddr))
    );
  if (decoded.type !== 'naddr' || decoded.data.kind !== TIP_OUTER_KIND) {
    throw new Error(`Verbindungscode hat unerwarteten kind (erwartet ${TIP_OUTER_KIND})`);
  }
  return {
    ephemeralPubkey: decoded.data.pubkey,
    dTag: decoded.data.identifier,
    relays: decoded.data.relays ?? [],
    ephemeralPrivateKey: parsed.ephemeralPrivateKey
  };
}

/**
 * Decrypt + verify a tip event and extract the advertised state.
 * The outer content is an owner NIP-44 self-seal of an owner-signed inner
 * kind-178 event; reject anything not provably from the owner.
 *
 * @param {import('nostr-tools').Event} outerEvent
 * @param {{ownerPubkey: string, nip44Decrypt: (pubkey: string, ciphertext: string) => Promise<string>}} params
 * @returns {Promise<{groupDocs: Array<{address: string, gid: string}>, metaDoc?: string, dek?: string, servers: string[], createdAt: number, eventId: string}>}
 */
export async function parseTipEvent(outerEvent, { ownerPubkey, nip44Decrypt }) {
  const plaintext = await nip44Decrypt(ownerPubkey, outerEvent.content);
  const inner = JSON.parse(plaintext);
  if (inner.kind !== TIP_INNER_KIND || inner.pubkey !== ownerPubkey || !verifyEvent(inner)) {
    throw new Error('Tip-Event ist nicht vom Owner signiert');
  }
  /** @type {Array<{address: string, gid: string}>} */
  const groupDocs = [];
  /** @type {string | undefined} */
  let metaDoc;
  /** @type {string | undefined} */
  let dek;
  /** @type {string[]} */
  const servers = [];
  for (const tag of inner.tags) {
    if (tag[0] === 'x' && tag[2] === 'group' && tag[1] && tag[3]) {
      groupDocs.push({ address: tag[1], gid: tag[3] });
    } else if (tag[0] === 'x' && tag[2] === 'meta' && tag[1]) {
      metaDoc = tag[1];
    } else if (tag[0] === 'dek' && tag[1]) {
      dek = tag[1];
    } else if (tag[0] === 'server' && tag[1]) {
      servers.push(tag[1]);
    }
  }
  return {
    groupDocs,
    metaDoc,
    dek,
    servers,
    createdAt: outerEvent.created_at,
    eventId: outerEvent.id
  };
}

/** @param {string} dekHex */
function dekConversationKey(dekHex) {
  const secret = hexToBytes(dekHex);
  return nip44.v2.utils.getConversationKey(secret, getPublicKey(secret));
}

/**
 * Unseal a document blob: verify sha256 address, NIP-44 decrypt with the DEK
 * self-seal, validate schema (spec §5, §7).
 *
 * @param {{sealedText: string, dekHex: string, expectedAddress: string}} params
 * @returns {Promise<Record<string, any>>}
 */
export async function unsealDocument({ sealedText, dekHex, expectedAddress }) {
  const address = await sha256Hex(new TextEncoder().encode(sealedText));
  if (address !== expectedAddress) {
    throw new Error('Dokument-Address stimmt nicht mit Inhalt überein');
  }
  const doc = JSON.parse(nip44.v2.decrypt(sealedText, dekConversationKey(dekHex)));
  if (doc?.schemaVersion !== 1) throw new Error('Unbekannte Dokument-Schema-Version');
  if (doc.type !== 'group' && doc.type !== 'meta') throw new Error('Unbekannter Dokumenttyp');
  return doc;
}

/**
 * Seal a document the way cordn-web does — exposed for tests (and a future
 * write side): NIP-44 self-seal under the DEK, address = sha256 of the sealed
 * UTF-8 text.
 *
 * @param {Record<string, any>} doc
 * @param {string} dekHex
 * @returns {Promise<{sealedText: string, address: string}>}
 */
export async function sealDocumentForTest(doc, dekHex) {
  const sealedText = nip44.v2.encrypt(JSON.stringify(doc), dekConversationKey(dekHex));
  return { sealedText, address: await sha256Hex(new TextEncoder().encode(sealedText)) };
}

/**
 * Spec §8 reconciliation: forward-only last-writer-wins by MLS epoch.
 * Tombstones drop local groups when tombstone.epoch >= local epoch and veto
 * seeding. Returns actions in doc order followed by tombstone drops.
 *
 * @param {object} params
 * @param {Array<{gid: string, epoch: bigint}>} params.localGroups
 * @param {Array<{gid: string, epoch: bigint, address: string}>} params.docs
 * @param {Array<{gid: string, epoch: number}>} params.tombstones
 * @returns {Array<{action: 'seed' | 'fastForward' | 'skip' | 'drop', gid: string, address?: string}>}
 */
export function planReconcile({ localGroups, docs, tombstones }) {
  const localByGid = new Map(localGroups.map((group) => [group.gid, group]));
  const tombstoneByGid = new Map(tombstones.map((tombstone) => [tombstone.gid, tombstone]));
  /** @type {Array<{action: 'seed' | 'fastForward' | 'skip' | 'drop', gid: string, address?: string}>} */
  const plan = [];
  for (const doc of docs) {
    const tombstone = tombstoneByGid.get(doc.gid);
    if (tombstone && BigInt(tombstone.epoch) >= doc.epoch) continue;
    const local = localByGid.get(doc.gid);
    if (!local) plan.push({ action: 'seed', gid: doc.gid, address: doc.address });
    else if (doc.epoch > local.epoch)
      plan.push({ action: 'fastForward', gid: doc.gid, address: doc.address });
    else plan.push({ action: 'skip', gid: doc.gid });
  }
  for (const tombstone of tombstones) {
    const local = localByGid.get(tombstone.gid);
    if (local && BigInt(tombstone.epoch) >= local.epoch) {
      plan.push({ action: 'drop', gid: tombstone.gid });
    }
  }
  return plan;
}
