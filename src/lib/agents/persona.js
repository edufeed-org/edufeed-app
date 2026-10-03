/**
 * Agent persona (kind 30175) and ownership record (kind 30177) — Buzz's
 * NIP-AP shapes, so a stock buzz-acp companion and Buzz's own tooling read
 * what we write. Pure builders and parsers; publishing lives in
 * agent-publish.js, loading in my-agents.svelte.js.
 *
 * The persona is the definition (name, instructions, runtime); the record is
 * the instance, keyed by the agent's pubkey, and is what makes a pubkey "an
 * agent owned by <owner>" for the badge. The record is authoritative for
 * respond_to (NIP-AP treats the persona's copy as a default). Neither ever
 * carries a secret.
 */

export const PERSONA_KIND = 30175;
export const AGENT_RECORD_KIND = 30177;
export const RUNTIMES = /** @type {const} */ (['claude', 'codex', 'buzz-agent']);
export const RESPOND_TO = /** @type {const} */ (['owner-only', 'anyone']);

const HEX64 = /^[0-9a-f]{64}$/;

const now = () => Math.floor(Date.now() / 1000);

/** @param {any} event @returns {string | undefined} */
function dTagOf(event) {
  return event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
}

/** @param {string} content @returns {Record<string, any> | null} */
function parseJSONObject(content) {
  try {
    const value = JSON.parse(content);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * NIP-AP grammar-safe persona slug, derived from the agent's own pubkey
 * rather than its (editable, non-unique) display name — a rename can never
 * orphan the persona a record's `definition` points at.
 * @param {string} agentPubkey
 */
export function personaSlugForAgent(agentPubkey) {
  return 'agent-' + agentPubkey.slice(0, 12);
}

/**
 * @typedef {{displayName: string, systemPrompt: string, runtime: string, avatarUrl: string | null, respondTo: string}} PersonaInput
 */

/**
 * @param {PersonaInput} input
 * @returns {{ok: true, value: PersonaInput} | {ok: false, error: 'name' | 'runtime' | 'respondTo'}}
 */
export function validatePersona(input) {
  if (!String(input.displayName ?? '').trim()) return { ok: false, error: 'name' };
  if (!RUNTIMES.includes(/** @type {any} */ (input.runtime)))
    return { ok: false, error: 'runtime' };
  if (!RESPOND_TO.includes(/** @type {any} */ (input.respondTo)))
    return { ok: false, error: 'respondTo' };
  return { ok: true, value: input };
}

/**
 * @param {{slug: string, displayName: string, systemPrompt: string, runtime: string, avatarUrl: string | null, respondTo: string}} persona
 */
export function buildPersonaTemplate(persona) {
  return {
    kind: PERSONA_KIND,
    created_at: now(),
    tags: [
      ['d', persona.slug],
      ['alt', 'agent persona definition']
    ],
    content: JSON.stringify({
      display_name: persona.displayName,
      system_prompt: persona.systemPrompt,
      runtime: persona.runtime,
      avatar_url: persona.avatarUrl || null,
      respond_to: persona.respondTo,
      respond_to_allowlist: [],
      session_policy: 'channel'
    })
  };
}

/**
 * @param {{agentPubkey: string, name: string, definition: string, respondTo: string, respondToAllowlist?: string[]}} record
 */
export function buildAgentRecordTemplate(record) {
  return {
    kind: AGENT_RECORD_KIND,
    created_at: now(),
    tags: [
      ['d', record.agentPubkey],
      ['alt', 'agent ownership record']
    ],
    content: JSON.stringify({
      name: record.name,
      definition: record.definition,
      respond_to: record.respondTo,
      respond_to_allowlist: Array.isArray(record.respondToAllowlist)
        ? record.respondToAllowlist
        : []
    })
  };
}

/** @param {any} event */
export function parsePersona(event) {
  if (event?.kind !== PERSONA_KIND) return null;
  const slug = dTagOf(event);
  if (!slug) return null;
  const body = parseJSONObject(event.content ?? '');
  if (!body) return null;
  return {
    slug,
    displayName: typeof body.display_name === 'string' ? body.display_name : slug,
    systemPrompt: typeof body.system_prompt === 'string' ? body.system_prompt : '',
    runtime: typeof body.runtime === 'string' ? body.runtime : '',
    avatarUrl: typeof body.avatar_url === 'string' ? body.avatar_url : null,
    respondTo: typeof body.respond_to === 'string' ? body.respond_to : 'owner-only'
  };
}

/** @param {any} event */
export function parseAgentRecord(event) {
  if (event?.kind !== AGENT_RECORD_KIND) return null;
  const agentPubkey = dTagOf(event);
  if (!agentPubkey || !HEX64.test(agentPubkey)) return null;
  const body = parseJSONObject(event.content ?? '');
  if (!body) return null;
  return {
    agentPubkey,
    ownerPubkey: event.pubkey,
    name: typeof body.name === 'string' ? body.name : '',
    definition: typeof body.definition === 'string' ? body.definition : '',
    respondTo: typeof body.respond_to === 'string' ? body.respond_to : 'owner-only',
    respondToAllowlist: Array.isArray(body.respond_to_allowlist)
      ? body.respond_to_allowlist.filter((/** @type {unknown} */ p) => typeof p === 'string')
      : []
  };
}

/** @param {string} ownerPubkey @param {string} agentPubkey */
export function agentRecordAddress(ownerPubkey, agentPubkey) {
  return `${AGENT_RECORD_KIND}:${ownerPubkey}:${agentPubkey}`;
}

/** @param {string} ownerPubkey @param {string} slug */
export function personaAddress(ownerPubkey, slug) {
  return `${PERSONA_KIND}:${ownerPubkey}:${slug}`;
}

/**
 * NIP-09 for both records. The companion stops the agent when its 30177
 * disappears; the persona goes with it so a re-created agent starts clean.
 * @param {{ownerPubkey: string, agentPubkey: string, slug: string}} args
 */
export function buildAgentDeletionTemplate({ ownerPubkey, agentPubkey, slug }) {
  return {
    kind: 5,
    created_at: now(),
    content: '',
    tags: [
      ['a', agentRecordAddress(ownerPubkey, agentPubkey)],
      ['a', personaAddress(ownerPubkey, slug)]
    ]
  };
}
