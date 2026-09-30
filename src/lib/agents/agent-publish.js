/**
 * Publishing an agent: its ownership record and persona to every groups
 * relay, and one put-user / remove-user per group. Everything is signed by
 * the owner and goes through publishToGroupRelay, which already answers
 * NIP-42 challenges and re-stamps moderation events the relay calls "too
 * old". The companion only ever reads the groups relay, so the outbox model
 * (publishEvent) is deliberately not used here.
 */
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import {
  publishToGroupRelay,
  buildPutUserTemplate,
  buildRemoveUserTemplate
} from '$lib/groups/group-management.js';
import {
  buildPersonaTemplate,
  buildAgentRecordTemplate,
  buildAgentDeletionTemplate
} from './persona.js';

/** @typedef {{id: string, relay: string}} GroupPointer */
/** @typedef {{relayFor?: (url: string) => any, relays?: string[], publish?: typeof publishToGroupRelay}} Deps */

/** @param {Deps} deps */
function resolveDeps(deps) {
  return {
    relayFor: deps.relayFor ?? ((/** @type {string} */ url) => pool.relay(url)),
    relays: deps.relays ?? getGroupsRelays(),
    publish: deps.publish ?? publishToGroupRelay
  };
}

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publish one template to every relay; resolves with the first accepted
 * signed event, throws the last error when no relay accepted.
 * @param {ReturnType<typeof resolveDeps>} d
 * @param {any} template
 * @param {{pubkey: string, signer: any}} user
 */
async function publishEverywhere(d, template, user) {
  /** @type {unknown} */
  let lastError;
  /** @type {any} */
  let accepted;
  for (const url of d.relays) {
    try {
      const signed = await d.publish(d.relayFor(url), template, user);
      accepted ??= signed;
    } catch (error) {
      lastError = error;
    }
  }
  if (!accepted) throw lastError instanceof Error ? lastError : new Error(message(lastError));
  return accepted;
}

/**
 * One moderation event per group, each to its own relay. Failures are
 * collected, never fatal: a record that is published is worth more than a
 * 9000 the relay refused, and the editor shows which groups did not take.
 * @param {ReturnType<typeof resolveDeps>} d
 * @param {GroupPointer[]} groups
 * @param {(groupId: string) => any} template
 * @param {{pubkey: string, signer: any}} user
 */
async function publishPerGroup(d, groups, template, user) {
  /** @type {Array<GroupPointer & {error: string}>} */
  const failed = [];
  for (const group of groups) {
    try {
      await d.publish(d.relayFor(group.relay), template(group.id), user);
    } catch (error) {
      failed.push({ ...group, error: message(error) });
    }
  }
  return failed;
}

/**
 * @param {{
 *   user: {pubkey: string, signer: any},
 *   persona: {slug: string, displayName: string, systemPrompt: string, runtime: string, avatarUrl: string | null, respondTo: string},
 *   record: {agentPubkey: string, name: string, definition: string, respondTo: string},
 *   addToGroups: GroupPointer[],
 *   removeFromGroups: GroupPointer[]
 * }} args
 * @param {Deps} [deps]
 */
export async function publishAgent(
  { user, persona, record, addToGroups, removeFromGroups },
  deps = {}
) {
  const d = resolveDeps(deps);
  const recordEvent = await publishEverywhere(d, buildAgentRecordTemplate(record), user);
  const personaEvent = await publishEverywhere(d, buildPersonaTemplate(persona), user);
  const failedGroups = [
    ...(await publishPerGroup(
      d,
      addToGroups,
      (id) => buildPutUserTemplate(id, record.agentPubkey),
      user
    )),
    ...(await publishPerGroup(
      d,
      removeFromGroups,
      (id) => buildRemoveUserTemplate(id, record.agentPubkey),
      user
    ))
  ];
  return { recordEvent, personaEvent, failedGroups };
}

/**
 * Leave the groups first (the agent is still "ours" while we do), then delete
 * both records so the companion stops it.
 * @param {{user: {pubkey: string, signer: any}, agentPubkey: string, slug: string, groups: GroupPointer[]}} args
 * @param {Deps} [deps]
 */
export async function removeAgent({ user, agentPubkey, slug, groups }, deps = {}) {
  const d = resolveDeps(deps);
  const failedGroups = await publishPerGroup(
    d,
    groups,
    (id) => buildRemoveUserTemplate(id, agentPubkey),
    user
  );
  const deletionEvent = await publishEverywhere(
    d,
    buildAgentDeletionTemplate({ ownerPubkey: user.pubkey, agentPubkey, slug }),
    user
  );
  return { deletionEvent, failedGroups };
}
