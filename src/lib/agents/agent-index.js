/**
 * Pure views over agent events, shared by the hooks in this folder.
 */
import { parseAgentRecord, parsePersona } from './persona.js';

/** Buzz presence: ephemeral kind 20001, content online|away|offline, no tags. */
export const PRESENCE_KIND = 20001;
/** A presence older than this counts as offline (buzz-acp re-announces well within it). */
export const PRESENCE_TTL_SECONDS = 5 * 60;

/**
 * @typedef {{
 *   agentPubkey: string, ownerPubkey: string, name: string, respondTo: string,
 *   persona: ReturnType<typeof parsePersona>, recordEvent: any, personaEvent: any
 * }} AgentEntry
 */

/**
 * Newest record per agent pubkey, joined to the persona named by its
 * `definition`, sorted by name. Records without a persona are kept (the
 * editor can still show and remove them).
 * @param {any[]} recordEvents kind 30177
 * @param {any[]} personaEvents kind 30175
 * @returns {AgentEntry[]}
 */
export function indexAgents(recordEvents, personaEvents) {
  /** @type {Map<string, any>} */
  const personasBySlug = new Map();
  for (const event of personaEvents) {
    const parsed = parsePersona(event);
    if (!parsed) continue;
    const current = personasBySlug.get(parsed.slug);
    if (!current || current.created_at < event.created_at) personasBySlug.set(parsed.slug, event);
  }

  /** @type {Map<string, any>} */
  const newestRecord = new Map();
  for (const event of recordEvents) {
    const parsed = parseAgentRecord(event);
    if (!parsed) continue;
    const current = newestRecord.get(parsed.agentPubkey);
    if (!current || current.created_at < event.created_at)
      newestRecord.set(parsed.agentPubkey, event);
  }

  /** @type {AgentEntry[]} */
  const out = [];
  for (const recordEvent of newestRecord.values()) {
    const record = /** @type {NonNullable<ReturnType<typeof parseAgentRecord>>} */ (
      parseAgentRecord(recordEvent)
    );
    const personaEvent = personasBySlug.get(record.definition) ?? null;
    out.push({
      agentPubkey: record.agentPubkey,
      ownerPubkey: record.ownerPubkey,
      name: record.name,
      respondTo: record.respondTo,
      persona: personaEvent ? parsePersona(personaEvent) : null,
      recordEvent,
      personaEvent
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {any[]} recordEvents kind 30177 from any owner
 * @returns {Map<string, {ownerPubkey: string, name: string}>}
 */
export function indexAgentRecords(recordEvents) {
  /** @type {Map<string, {ownerPubkey: string, name: string, at: number}>} */
  const map = new Map();
  for (const event of recordEvents) {
    const parsed = parseAgentRecord(event);
    if (!parsed) continue;
    const current = map.get(parsed.agentPubkey);
    if (!current || current.at < event.created_at) {
      map.set(parsed.agentPubkey, {
        ownerPubkey: parsed.ownerPubkey,
        name: parsed.name,
        at: event.created_at
      });
    }
  }
  return new Map([...map].map(([k, v]) => [k, { ownerPubkey: v.ownerPubkey, name: v.name }]));
}

/**
 * @param {{status: string, at: number} | undefined} entry
 * @param {number} nowSeconds
 */
export function presenceIsOnline(entry, nowSeconds) {
  if (!entry) return false;
  if (entry.status !== 'online' && entry.status !== 'away') return false;
  return nowSeconds - entry.at <= PRESENCE_TTL_SECONDS;
}
