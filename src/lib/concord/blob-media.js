// Decrypt Concord's encrypted community icon/banner blobs.
//
// A `CommunityMetadata.icon`/`banner` is a `BlobPointer` — `{url, key, nonce,
// hash}` — pointing at an AES-256-GCM-encrypted file on a Blossom server, with
// the symmetric key/nonce riding in the (members-only) control plane. This
// module decrypts one, given the pointer.
//
// Cipher — verified against applesauce-concord's own source, not guessed:
//   - `helpers/imeta.js` header comment: "Concord chat media is encrypted
//     client-side before upload: the blob at `url` is AES-256-GCM ciphertext
//     and the per-file key/nonce ride in the message's `imeta` tag" — the
//     same encrypt-then-upload convention `client/storage.d.ts`'s
//     `ConcordUploader` doc says is reused for "a community `BlobPointer`".
//   - `helpers/imeta.d.ts`'s `AttachmentEncryption` JSDoc spells out the
//     concrete parameters: "AES-256 key, lowercase hex (64 chars)" and
//     "AES-GCM nonce/IV, lowercase hex (we use a 16-byte, 0xChat-compatible
//     nonce)" — i.e. a 32-byte key and a 16-byte IV, not the more common
//     12-byte GCM nonce. The Web Crypto AES-GCM implementation accepts any IV
//     length (NIST SP800-38D), so this decrypts with a plain `crypto.subtle`
//     call, no bit-twiddling required.
//   - `client/admin.js`'s `setCommunityImage` builds the `BlobPointer` as
//     `hash: att.originalSha256` — applesauce-common's NIP-92 `ox` field, the
//     hash of the DECRYPTED plaintext, not the ciphertext at `url` (that
//     would be `x`/`sha256`). So verification here hashes the plaintext
//     AFTER decrypting, never the downloaded bytes directly.
//
// No package imports on purpose: everything needed (AES-256-GCM, SHA-256) is
// the platform Web Crypto API (`crypto.subtle`), already this app's
// convention for hashing (see `helpers/sha256.js`, `helpers/nip98.js`) — so
// this module carries zero SSR-chunk risk regardless of where it's imported
// from. Actual browser-only behavior (`fetch`, `URL.createObjectURL`) is
// still real: callers must only invoke `fetchDecryptedBlobUrl` from
// browser-side code (a Svelte `$effect`, never during SSR/module-load) — see
// `blob-media.svelte.js`'s `useConcordAreaIcon`, the only intended caller.

/**
 * @typedef {{url?: string, key?: string, nonce?: string, hash?: string}} BlobPointerLike
 * A `CommunityMetadata.icon`/`banner` shape (applesauce-concord's `BlobPointer`),
 * loosened to optional fields since callers often pass a possibly-absent one.
 */

/** @param {string} hex */
function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error('invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('invalid hex string');
    bytes[i] = byte;
  }
  return bytes;
}

/** @param {Uint8Array} bytes */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decrypt an AES-256-GCM ciphertext using Concord's community-image / chat-
 * media blob-encryption convention. Pure: takes ciphertext bytes plus the
 * hex key/nonce carried alongside the `BlobPointer`, returns plaintext bytes.
 * Throws if the key/nonce are malformed or the GCM auth tag doesn't verify
 * (wrong key, wrong nonce, or corrupted/tampered ciphertext).
 * @param {Uint8Array} bytes ciphertext, including the trailing 16-byte GCM auth tag
 * @param {string} keyHex 64-char lowercase hex (AES-256 key, 32 bytes)
 * @param {string} nonceHex 32-char lowercase hex (16-byte GCM nonce/IV)
 * @returns {Promise<Uint8Array>}
 */
export async function decryptBlob(bytes, keyHex, nonceHex) {
  const keyBytes = hexToBytes(keyHex);
  const nonceBytes = hexToBytes(nonceHex);
  // Casts below: TS's lib.dom types `Uint8Array` (unparameterized, as JSDoc
  // `{Uint8Array}` resolves) as `Uint8Array<ArrayBufferLike>`, which isn't
  // structurally assignable to `BufferSource` (`ArrayBufferView<ArrayBuffer>`)
  // — a real Web Crypto API call with real Uint8Arrays works fine at
  // runtime; this is a type-only mismatch every plain-JS project hits here.
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    /** @type {any} */ (keyBytes),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: /** @type {any} */ (nonceBytes) },
    cryptoKey,
    /** @type {any} */ (bytes)
  );
  return new Uint8Array(plaintext);
}

// Module-level cache: BlobPointer.hash -> resolved object URL, or `null` for
// a hash that failed once (fetch/decrypt/hash-mismatch). Caching failures
// (not just successes) is what makes the "warn once" contract in
// `fetchDecryptedBlobUrl` hold — a broken pointer doesn't re-warn on every
// re-render/remount. Concurrent callers for the same hash (e.g. the sidebar
// badge and the `/private/[id]` header both mounting at once) share one
// in-flight request by caching the Promise itself before it settles.
const blobUrlCache = new Map();

// PHASE-1 DECISION (documented, not deferred by accident): object URLs
// created here are never revoked. `URL.revokeObjectURL` would need a
// teardown hook threaded through every render call site (badge unmount,
// page navigation, cache eviction), and the actual footprint is tiny — at
// most one small icon per distinct Concord community a user has ever seen
// this session, cached forever by `blobUrlCache` (never evicted, so a given
// icon is only ever decrypted once per session regardless of revocation).
// The leak is bounded by "communities visited this tab session", not by
// render count. Revisit if banners (much larger blobs, follow-up) reuse this
// cache without a size cap.

/**
 * Fetch, decrypt, and verify a Concord `BlobPointer` (a community icon or
 * banner), returning a `blob:` object URL suitable for an `<img src>` — or
 * `null` if anything fails (missing/malformed pointer, network error,
 * decrypt failure, or a plaintext-hash mismatch). Browser-only: uses `fetch`
 * and `URL.createObjectURL`, so only call this from client-side code (a
 * Svelte `$effect`), never at module load or during SSR.
 *
 * Caches by `pointer.hash` at the module level by default (shared across
 * every caller in the same tab) — pass `{cache}` with a fresh `Map` in tests
 * to avoid cross-test pollution. A failure is cached too (see the Phase-1
 * decision above `blobUrlCache`), so a broken pointer only ever warns once.
 * @param {{url?: string, key?: string, nonce?: string, hash?: string} | null | undefined} pointer
 * @param {{cache?: Map<string, Promise<string|null>|string|null>}} [options]
 * @returns {Promise<string|null>}
 */
export async function fetchDecryptedBlobUrl(pointer, options = {}) {
  const cache = options.cache ?? blobUrlCache;

  if (!pointer?.url || !pointer?.key || !pointer?.nonce || !pointer?.hash) return null;
  const { url, key, nonce, hash } = pointer;

  if (cache.has(hash)) return cache.get(hash);

  const pending = (async () => {
    try {
      if (typeof fetch !== 'function' || typeof URL?.createObjectURL !== 'function') return null;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fetch failed with status ${response.status}`);
      const cipherBytes = new Uint8Array(await response.arrayBuffer());
      const plainBytes = await decryptBlob(cipherBytes, key, nonce);
      const digest = await crypto.subtle.digest('SHA-256', /** @type {any} */ (plainBytes));
      if (bytesToHex(new Uint8Array(digest)) !== hash.toLowerCase()) {
        throw new Error('decrypted plaintext sha256 does not match BlobPointer.hash');
      }
      return URL.createObjectURL(new Blob([/** @type {any} */ (plainBytes)]));
    } catch (err) {
      console.warn('[concord] failed to decrypt community image', err);
      return null;
    }
  })();

  cache.set(hash, pending);
  const resolved = await pending;
  cache.set(hash, resolved); // replace the in-flight promise with its settled value
  return resolved;
}

// Chat-attachment cache, keyed by attachment URL (a Blossom URL embeds the
// ciphertext hash, so it is content-addressed and safe to cache on). Kept
// separate from `blobUrlCache` (keyed by plaintext hash) so the two schemes
// can never collide. Same Phase-1 no-revoke decision applies — bounded by
// attachments actually viewed this tab session.
const attachmentUrlCache = new Map();

/**
 * Resolve a chat-message `MediaAttachment` (see attachments.js) to a
 * displayable URL. Unencrypted attachments pass through as their own URL —
 * no fetch. Encrypted ones are fetched, AES-256-GCM-decrypted with the
 * imeta-carried key/nonce, verified against `originalSha256` (NIP-92 `ox`,
 * the plaintext hash) WHEN the sender provided one, and returned as a
 * `blob:` object URL. Returns `null` on any failure (missing url, network,
 * decrypt, hash mismatch) — failures are cached so a broken attachment
 * warns once, not once per re-render.
 *
 * Browser-only (fetch + URL.createObjectURL): call from a `$effect`, never
 * during SSR/module load — same contract as `fetchDecryptedBlobUrl`.
 * @param {{url?: string, type?: string, originalSha256?: string, encryption?: {algorithm: string, key: string, nonce: string}, [key: string]: any} | null | undefined} att
 * @param {{cache?: Map<string, Promise<string|null>|string|null>}} [options]
 * @returns {Promise<string|null>}
 */
export async function fetchDecryptedAttachmentUrl(att, options = {}) {
  const cache = options.cache ?? attachmentUrlCache;

  if (!att?.url) return null;
  if (!att.encryption) return att.url;
  const { url, originalSha256 } = att;
  const { key, nonce } = att.encryption;

  if (cache.has(url)) return cache.get(url);

  const pending = (async () => {
    try {
      if (typeof fetch !== 'function' || typeof URL?.createObjectURL !== 'function') return null;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fetch failed with status ${response.status}`);
      const cipherBytes = new Uint8Array(await response.arrayBuffer());
      const plainBytes = await decryptBlob(cipherBytes, key, nonce);
      if (originalSha256) {
        const digest = await crypto.subtle.digest('SHA-256', /** @type {any} */ (plainBytes));
        if (bytesToHex(new Uint8Array(digest)) !== originalSha256.toLowerCase()) {
          throw new Error('decrypted plaintext sha256 does not match imeta ox');
        }
      }
      return URL.createObjectURL(new Blob([/** @type {any} */ (plainBytes)]));
    } catch (err) {
      console.warn('[concord] failed to decrypt chat attachment', err);
      return null;
    }
  })();

  cache.set(url, pending);
  const resolved = await pending;
  cache.set(url, resolved); // replace the in-flight promise with its settled value
  return resolved;
}
