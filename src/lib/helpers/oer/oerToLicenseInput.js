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

  const credit =
    system.attribution ||
    (Array.isArray(amb.creator)
      ? amb.creator
          .map((c) => c?.name)
          .filter(Boolean)
          .join(', ')
      : '') ||
    '';
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
