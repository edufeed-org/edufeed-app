/**
 * Cordn groups spike barrel. SSR-safe exports only — `storage.js`,
 * `client.svelte.js`, `mls.js`, and `coordinator-rpc.js` are browser-only and
 * must be imported directly (dynamically) from ssr=false code.
 */
export { parseCordnGroupsConfig } from './config.js';
export { buildEnvelope, validateEnvelope, CORDN_CHAT_KIND } from './envelope.js';
export { sealPayload, unsealPayload } from './sealed-payload.js';
