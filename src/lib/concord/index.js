// Single entry point for all Concord functionality. Everything outside
// src/lib/concord/ must import from here (enforced by no-restricted-imports)
// so pre-1.0 package churn stays contained in this directory.
// Exports grow as the wrapper modules land.
// EXCEPTION: components rendered during SSR (e.g. ContentNavSidebar,
// BottomTabBar) must import shouldShowChannelsTab/useConcordCommunity
// directly from './community.svelte.js' instead of this barrel — the
// barrel also re-exports storage.js, which statically imports
// applesauce-core-concord/nostr-tools and would otherwise pull that
// dependency tree into server chunks. community.svelte.js itself only
// imports pointer.js/client.svelte.js/bridge.svelte.js, none of which have
// top-level package imports, so the direct submodule import is SSR-clean.
export { parseConcordPointer, buildConcordPointerTag, withConcordPointer } from './pointer.js';
export { concordDbName, createConcordStorage, createConcordStoreFactory } from './storage.js';
export { deleteConcordDb } from './idb-database.js';
export {
  initConcordService,
  getConcordState,
  getConcordClient,
  signerHasNip44,
  wipeConcordData
} from './client.svelte.js';
export { useObservable } from './bridge.svelte.js';
export { shouldShowChannelsTab, useConcordCommunity } from './community.svelte.js';
export { foundConcordArea, buildPointerUpdate } from './founding.js';
export { pickLatestChannelInvite, createChannelInviteOnce } from './invite-helpers.js';
