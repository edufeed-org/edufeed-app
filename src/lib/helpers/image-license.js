/**
 * Builds a kind 1063 event template for an image license attestation.
 * Pure function: no I/O, no signing. Caller signs + publishes.
 *
 * NIP-94 (file metadata) provides the bones: url, x (sha256), m (mime).
 * We add three application tags for the license attestation semantics:
 *   - license: license URL (CC, MIT, etc.)
 *   - credit:  human-readable attribution
 *   - source:  (optional) where the image was originally found
 *   - p:       (optional) attribution to a Nostr pubkey
 *
 * @param {{
 *   hash: string,
 *   url: string,
 *   mime: string,
 *   license: string,
 *   credit: string,
 *   source?: string,
 *   creatorPubkey?: string,
 *   description?: string,
 *   size?: number,
 *   dim?: string
 * }} input
 * @returns {{ kind: 1063, content: string, tags: string[][] }}
 */
export function buildLicenseTemplate(input) {
  const { hash, url, mime, license, credit, source, creatorPubkey, description, size, dim } = input;
  if (!hash) throw new Error('buildLicenseTemplate: hash is required');
  if (!url) throw new Error('buildLicenseTemplate: url is required');
  if (!mime) throw new Error('buildLicenseTemplate: mime is required');
  if (!license) throw new Error('buildLicenseTemplate: license is required');
  if (!credit) throw new Error('buildLicenseTemplate: credit is required');

  /** @type {string[][]} */
  const tags = [
    ['url', url],
    ['x', hash],
    ['m', mime]
  ];
  if (typeof size === 'number') tags.push(['size', String(size)]);
  if (dim) tags.push(['dim', dim]);
  tags.push(['license', license]);
  tags.push(['credit', credit]);
  if (source) tags.push(['source', source]);
  if (creatorPubkey) tags.push(['p', creatorPubkey]);

  return {
    kind: 1063,
    content: description ?? '',
    tags
  };
}
