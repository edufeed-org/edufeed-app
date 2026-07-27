/**
 * MLS glue for the Cordn groups spike — thin adapters over ts-mls following
 * Cordn spec/00 (identity binding), spec/01 (metadata capability), spec/03
 * (payload sealing key derivation).
 *
 * Adapted from cordn-web's chatMlsUtils.ts / chatKeyPackages.svelte.ts (MIT,
 * © 2026 the Cordn contributors). Browser-only — import via $lib/cordn.
 */
import {
  base64ToBytes,
  bytesToBase64,
  clientStateDecoder,
  clientStateEncoder,
  createApplicationMessage,
  createCommit,
  createGroup,
  defaultCapabilities,
  defaultCredentialTypes,
  encode,
  generateKeyPackage,
  getCiphersuiteImpl,
  getGroupMembers,
  joinGroup,
  keyPackageDecoder,
  keyPackageEncoder,
  makeKeyPackageRef,
  mlsExporter,
  mlsMessageDecoder,
  mlsMessageEncoder,
  nobleCryptoProvider,
  privateKeyPackageDecoder,
  privateKeyPackageEncoder,
  processMessage,
  protocolVersions,
  unsafeTestingAuthenticationService,
  wireformats
} from 'ts-mls';
import { verifyEvent } from 'nostr-tools/pure';

export const CORDN_CIPHERSUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';
/** spec/01 §2 — advertise metadata-extension support for interop with cordn-web groups. */
const CORDN_GROUP_METADATA_EXTENSION_TYPE = 0xc04d;
const APP_DATA_DICTIONARY_EXTENSION_TYPE = 0x0006;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** @type {Promise<import('ts-mls').CiphersuiteImpl> | undefined} */
let cipherSuitePromise;
function getCipherSuite() {
  cipherSuitePromise ??= getCiphersuiteImpl(CORDN_CIPHERSUITE, nobleCryptoProvider);
  return cipherSuitePromise;
}

/** @typedef {import('ts-mls').ClientState} ClientState */

/** @param {Awaited<ReturnType<typeof getCiphersuiteImpl>>} cipherSuite */
function mlsContext(cipherSuite) {
  return { cipherSuite, authService: unsafeTestingAuthenticationService };
}

/**
 * BasicCredential identity bytes → hex pubkey (spec/00 §6). Throws for
 * non-basic credential types, which the spike does not support.
 *
 * @param {import('ts-mls').KeyPackage['leafNode']['credential']} credential
 */
function credentialIdentity(credential) {
  const identity = /** @type {{identity?: Uint8Array}} */ (credential).identity;
  if (!(identity instanceof Uint8Array)) {
    throw new Error('Unsupported MLS credential type');
  }
  return decoder.decode(identity);
}

function metadataCapabilities() {
  const capabilities = defaultCapabilities();
  for (const type of [CORDN_GROUP_METADATA_EXTENSION_TYPE, APP_DATA_DICTIONARY_EXTENSION_TYPE]) {
    if (!capabilities.extensions.includes(type)) {
      capabilities.extensions = [...capabilities.extensions, type];
    }
  }
  return capabilities;
}

/** @param {Uint8Array} bytes */
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a KeyPackage bound to the user's stable Nostr pubkey (spec/00 §6).
 *
 * @param {string} stablePubkey - hex pubkey
 * @returns {Promise<{keyPackageRef: string, keyPackageBase64: string, privateKeyPackageBase64: string}>}
 */
export async function generateChatKeyPackage(stablePubkey) {
  const cipherSuite = await getCipherSuite();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const generated = await generateKeyPackage({
    credential: {
      credentialType: defaultCredentialTypes.basic,
      identity: encoder.encode(stablePubkey)
    },
    cipherSuite,
    capabilities: metadataCapabilities(),
    lifetime: {
      notBefore: BigInt(nowSeconds - 86400),
      // ~100-year notAfter: MLS-level expiry disabled, mirroring cordn-web
      notAfter: BigInt(nowSeconds + 3153600000)
    }
  });
  return {
    keyPackageRef: bytesToHex(await makeKeyPackageRef(generated.publicPackage, cipherSuite.hash)),
    keyPackageBase64: bytesToBase64(encode(keyPackageEncoder, generated.publicPackage)),
    privateKeyPackageBase64: bytesToBase64(
      encode(privateKeyPackageEncoder, generated.privatePackage)
    )
  };
}

/**
 * @param {{keyPackageBase64: string, privateKeyPackageBase64: string}} record
 */
export function decodeKeyPackagePair(record) {
  const keyPackage = keyPackageDecoder(base64ToBytes(record.keyPackageBase64), 0);
  const privateKeyPackage = privateKeyPackageDecoder(
    base64ToBytes(record.privateKeyPackageBase64),
    0
  );
  if (!keyPackage || !privateKeyPackage) throw new Error('Unable to decode stored key package');
  return { keyPackage: keyPackage[0], privateKeyPackage: privateKeyPackage[0] };
}

/**
 * Verify a consumed publication event and extract the KeyPackage (spec/00 §9):
 * event signature valid, embedded credential identity equals the event signer.
 *
 * @param {{pk: string, event: import('nostr-tools').Event}} consumed
 * @returns {import('ts-mls').KeyPackage}
 */
export function parseConsumedKeyPackage(consumed) {
  if (!verifyEvent(consumed.event)) throw new Error('Invalid publication event signature');
  const parsed = JSON.parse(consumed.event.content);
  const kp64 = parsed?.params?.arguments?.kp_64 ?? parsed?.params?.arguments?.keyPackageBase64;
  if (typeof kp64 !== 'string' || !kp64) throw new Error('Missing kp_64 in publication event');
  const decoded = keyPackageDecoder(base64ToBytes(kp64), 0);
  if (!decoded) throw new Error('Unable to decode consumed key package');
  const identity = credentialIdentity(decoded[0].leafNode.credential);
  if (identity !== consumed.event.pubkey || identity !== consumed.pk) {
    throw new Error('Key package credential identity does not match publication signer');
  }
  return decoded[0];
}

/**
 * Create a fresh group (no shared metadata extension in the spike — group
 * names stay local; spec/01 marks the extension optional).
 *
 * @param {ReturnType<typeof decodeKeyPackagePair>} pair
 */
export async function createInitialGroupState(pair) {
  const cipherSuite = await getCipherSuite();
  return createGroup({
    context: mlsContext(cipherSuite),
    groupId: encoder.encode(crypto.randomUUID()),
    keyPackage: pair.keyPackage,
    privateKeyPackage: pair.privateKeyPackage,
    extensions: []
  });
}

/**
 * Delivery gid = utf8 groupId (client convention, spec/03 §2).
 * @param {ClientState} state
 */
export function getGid(state) {
  return decoder.decode(state.groupContext.groupId);
}

/**
 * Stable pubkeys of all current members (BasicCredential identities).
 * @param {ClientState} state
 */
export function listMemberPubkeys(state) {
  return getGroupMembers(state).map((leaf) => credentialIdentity(leaf.credential));
}

/**
 * Add a member. The returned commit must be sealed under the PRE-commit state
 * (spec/03 §5) and posted before adopting `newState` and storing the welcome.
 *
 * @param {{state: ClientState, memberKeyPackage: import('ts-mls').KeyPackage}} params
 */
export async function addMember({ state, memberKeyPackage }) {
  const cipherSuite = await getCipherSuite();
  const result = await createCommit({
    context: mlsContext(cipherSuite),
    state,
    ratchetTreeExtension: true,
    extraProposals: [{ proposalType: 1, add: { keyPackage: memberKeyPackage } }]
  });
  if (!result.welcome) throw new Error('Commit did not produce a welcome message');
  return {
    newState: result.newState,
    commitMessageBase64: bytesToBase64(encode(mlsMessageEncoder, result.commit)),
    welcomeBase64: bytesToBase64(
      encode(mlsMessageEncoder, {
        version: protocolVersions.mls10,
        wireformat: wireformats.mls_welcome,
        welcome: result.welcome.welcome
      })
    )
  };
}

/**
 * @param {{welcomeBase64: string, keyPackage: import('ts-mls').KeyPackage, privateKeyPackage: import('ts-mls').PrivateKeyPackage}} params
 */
export async function joinFromWelcome({ welcomeBase64, keyPackage, privateKeyPackage }) {
  const cipherSuite = await getCipherSuite();
  const decoded = mlsMessageDecoder(base64ToBytes(welcomeBase64), 0);
  if (!decoded || decoded[0].wireformat !== wireformats.mls_welcome) {
    throw new Error('Unable to decode welcome message');
  }
  return joinGroup({
    context: mlsContext(cipherSuite),
    welcome: decoded[0].welcome,
    keyPackage,
    privateKeys: privateKeyPackage
  });
}

/**
 * Encrypt an envelope into an opaque MLS application message. The sender's
 * stable pubkey rides in the authenticated data so receivers can bind the
 * envelope pubkey to the MLS-authenticated sender (cordn-web convention).
 *
 * @param {{state: ClientState, envelopeJson: string, senderPubkey: string}} params
 * @returns {Promise<{newState: ClientState, opaqueMessageBase64: string}>}
 */
export async function createChatMessage({ state, envelopeJson, senderPubkey }) {
  const cipherSuite = await getCipherSuite();
  const result = await createApplicationMessage({
    context: mlsContext(cipherSuite),
    state,
    message: encoder.encode(envelopeJson),
    authenticatedData: encoder.encode(senderPubkey)
  });
  return {
    newState: result.newState,
    opaqueMessageBase64: bytesToBase64(encode(mlsMessageEncoder, result.message))
  };
}

/**
 * Process one unsealed opaque MLS message.
 *
 * @param {{state: ClientState, opaqueMessageBase64: string}} params
 * @returns {Promise<{kind: 'application', envelopeJson: string, senderPubkey: string, newState: ClientState} | {kind: 'state', newState: ClientState}>}
 */
export async function processOpaqueMessage({ state, opaqueMessageBase64 }) {
  const cipherSuite = await getCipherSuite();
  const decoded = mlsMessageDecoder(base64ToBytes(opaqueMessageBase64), 0);
  if (!decoded || (decoded[0].wireformat !== 1 && decoded[0].wireformat !== 2)) {
    throw new Error('Expected framed MLS message');
  }
  const result = await processMessage({
    context: mlsContext(cipherSuite),
    state,
    message: decoded[0]
  });
  if (result.kind === 'applicationMessage') {
    return {
      kind: 'application',
      envelopeJson: decoder.decode(result.message),
      senderPubkey: decoder.decode(result.aad),
      newState: result.newState
    };
  }
  return { kind: 'state', newState: result.newState };
}

/**
 * spec/03 §4 — per-epoch 32-byte sealing key from the MLS exporter.
 * @param {ClientState} state
 */
export async function deriveGroupPayloadKey(state) {
  const cipherSuite = await getCipherSuite();
  return mlsExporter(
    state.keySchedule.exporterSecret,
    'cordn',
    encoder.encode('group-payload'),
    32,
    cipherSuite
  );
}

/** @param {ClientState} state */
export function encodeStateBase64(state) {
  return bytesToBase64(encode(clientStateEncoder, state));
}

/** @param {string} stateBase64 */
export function decodeStateBase64(stateBase64) {
  const decoded = clientStateDecoder(base64ToBytes(stateBase64), 0);
  if (!decoded) throw new Error('Unable to decode stored MLS state');
  return decoded[0];
}
