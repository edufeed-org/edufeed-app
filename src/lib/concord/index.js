// Entry point for Concord functionality that isn't reached via a direct
// submodule import (enforced by no-restricted-imports: everything outside
// src/lib/concord/ must go through './' or a named submodule under it, never
// `applesauce-concord`/`applesauce-core-concord` directly).
//
// THE ACTUAL RULE (final review — this comment used to describe an
// "EXCEPTION" that was really the norm): every component in this codebase
// imports Concord submodules DIRECTLY (e.g. `$lib/concord/community.svelte.js`,
// `$lib/concord/bridge.svelte.js`, `$lib/concord/moderation.js`) rather than
// through this barrel — none of them currently import from here at all. This
// barrel exists for non-component / dynamic-import call sites. It is NOT an
// exhaustive listing: `chat-helpers.js` (component-only) and
// `account-removal-watcher.js` (internal to client.svelte.js) are deliberately
// not re-exported. `storage.js` is
// deliberately NOT re-exported here: it statically imports
// applesauce-core-concord, and re-exporting it would make importing ANYTHING
// from this barrel pull that dependency tree into server chunks. Every
// consumer of storage.js already reaches it via a dynamic `import('./storage.js')`
// (see client.svelte.js) or a direct test import — keep it that way; do not
// add it back.
export { parseConcordPointer, buildConcordPointerTag, withConcordPointer } from './pointer.js';
export { deleteConcordDb } from './idb-database.js';
export {
  initConcordService,
  getConcordState,
  getConcordClient,
  wipeConcordData
} from './client.svelte.js';
export { useObservable } from './bridge.svelte.js';
export { shouldShowChannelsTab, useConcordCommunity } from './community.svelte.js';
export { foundConcordArea, buildPointerUpdate } from './founding.js';
export {
  pickLatestChannelInvite,
  createChannelInviteOnce,
  resolveInviteWrap
} from './invite-helpers.js';
export { channelMemberList, kickFromChannel, banFromChannel } from './moderation.js';
export {
  markChannelRead,
  channelUnreadState,
  areaUnreadState,
  getChannelLevel,
  setChannelLevel,
  getToastsEnabled,
  setToastsEnabled
} from './notifications.svelte.js';
export {
  getActiveConcordChannel,
  setActiveConcordChannel,
  clearActiveConcordChannel
} from './active-channel.svelte.js';
