/**
 * Derive a human-readable credit string from an OER item, or '' if none.
 * Prefers the proxy's pre-composed attribution, falling back to creator names.
 * @param {any} item - OerItem
 * @returns {string}
 */
export function deriveOerCredit(item) {
  const amb = item?.amb ?? {};
  const system = item?.extensions?.system ?? {};
  return (
    system.attribution ||
    (Array.isArray(amb.creator)
      ? amb.creator
          .map((/** @type {{ name?: string }} */ c) => c?.name)
          .filter(Boolean)
          .join(', ')
      : '') ||
    ''
  );
}

/**
 * Whether a kind-1063 attestation can be honestly built for this item: it needs
 * a resolvable URL, a license URI, and a credit. Items failing this are excluded
 * from the picker grid so the user never clicks an un-attestable tile.
 * @param {any} item - OerItem
 * @returns {boolean}
 */
export function isOerItemLicensable(item) {
  const amb = item?.amb ?? {};
  return Boolean(amb.id && amb.license?.id && deriveOerCredit(item));
}

/**
 * Map an OER search hit (`OerItem`) + the asset endpoint's `{ sha256, mime,
 * size }` into the input object `buildLicenseTemplate` expects. Pure.
 *
 * Returns null when a kind-1063 attestation cannot be honestly built — no
 * resolvable license URI, or no credit. The caller excludes such items from
 * the grid / aborts the pick rather than minting a bogus attestation.
 *
 * @typedef {{ sha256: string, mime: string, size?: number }} AssetMeta
 * @param {any} item - OerItem (see oer-finder-plugin docs/client-packages.md)
 * @param {AssetMeta} asset
 * @returns {{ url: string, hash: string, mime: string, size?: number, license: string, credit: string, source?: string, title?: string, dim?: string } | null}
 */
export function oerToLicenseInput(item, asset) {
  const amb = item?.amb ?? {};
  const system = item?.extensions?.system ?? {};
  const fileMetadata = item?.extensions?.fileMetadata ?? {};

  const url = amb.id;
  const license = amb.license?.id;
  if (!url || !license) return null;

  const credit = deriveOerCredit(item);
  if (!credit) return null;

  /** @type {{ url: string, hash: string, mime: string, size?: number, license: string, credit: string, source?: string, title?: string, dim?: string }} */
  const input = {
    url,
    hash: asset.sha256,
    mime: asset.mime,
    ...(typeof asset.size === 'number' && { size: asset.size }),
    license,
    credit,
    source: system.foreignLandingUrl || url,
    ...(amb.name && { title: amb.name }),
    ...(fileMetadata.fileDim && { dim: fileMetadata.fileDim })
  };
  return input;
}
