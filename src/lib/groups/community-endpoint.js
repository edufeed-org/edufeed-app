// The groups relay speaks two addresses for the same host: the FLAT host
// (wss://groups.edufeed.org), where any whitelisted account may CREATE a
// group, and the per-community virtual endpoint (wss://host/c/<rootId>) that
// scopes reads/writes to one community's subtree so clients like Armada show
// one dedicated space per community. CREATE must use the flat host — the /c
// write guard rejects a kind-9007/9002 for a group not yet in the subtree —
// while channel pointers and personal-list entries are ADDRESSED via /c so
// each community renders as its own space. These two helpers convert between
// the forms. See docs/superpowers/plans/2026-08-19-nip29-stories-roadmap.md
// (R3) and the pyramid fork's groups/virtual.go for the relay side.
import { normalizeURL } from 'applesauce-core/helpers/url';

// A trailing `/c/<rootId>` segment — the groups relay's only path convention.
// Match any single non-slash id (not hex-only) so the round-trip is exact for
// whatever id shape a community's root group actually has: communityGroupsEndpoint
// appends `/c/<rootId>` for ANY id, so flatGroupsRelay must strip the same, or a
// create would wrongly target /c and hit the relay's write guard. This only ever
// runs on groups-relay URLs the app itself built, where `/c/<id>` is unambiguous.
const COMMUNITY_PATH = /\/c\/[^/]+\/?$/;

/**
 * The flat groups relay for a URL that may already be a per-community
 * endpoint: strips a trailing `/c/<rootId>` back to the host. Idempotent — an
 * already-flat URL round-trips unchanged (modulo normalisation). Use this for
 * every CREATE / moderation write, which must land on the flat host.
 * @param {string} url
 * @returns {string}
 */
export function flatGroupsRelay(url) {
  if (typeof url !== 'string') return url;
  return normalizeURL(url.replace(COMMUNITY_PATH, ''));
}

/**
 * The per-community virtual endpoint for a root group:
 * `wss://<host>/c/<rootId>` (normalised, no trailing slash). `flatBaseRelay`
 * may itself carry a `/c/...` path — it is flattened first, so this is safe to
 * call with any groups-relay URL and stays idempotent.
 * @param {string} flatBaseRelay
 * @param {string} rootId
 * @returns {string}
 */
export function communityGroupsEndpoint(flatBaseRelay, rootId) {
  const flat = flatGroupsRelay(flatBaseRelay); // normalised, ends with '/'
  return normalizeURL(`${flat.replace(/\/$/, '')}/c/${rootId}`);
}
