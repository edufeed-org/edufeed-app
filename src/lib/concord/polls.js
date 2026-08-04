// NIP-88 polls in Concord channels (CORD.md "Polls").
//
// A poll is a kind-1068 rumor: question in `content`, options as
// `["option", id, label]` tags, `polltype` singlechoice|multiplechoice,
// optional `endsAt` (unix seconds). A vote is a kind-1018 rumor `e`-tagging
// the poll with `["response", id]` tags. The tally is deterministic — latest
// vote per pubkey (epoch-ms ordering), votes after endsAt ignored, responses
// naming undeclared options dropped — so every client folds the same counts
// from the same rumors (semantics verified against Armada src/lib/polls.ts;
// implementation is our own).
//
// Pure module — no package imports (src/lib/concord SSR convention). Votes
// publish through community.sendEvent, same CORD-03 binding as chat.

/**
 * @typedef {{id: string, label: string}} PollOption
 * @typedef {{id: string, question: string, options: PollOption[], pollType: 'singlechoice'|'multiplechoice', endsAt: number | undefined}} ParsedPoll
 * @typedef {{pubkey: string, optionIds: string[], ms: number}} PollVote
 * @typedef {{counts: Map<string, number>, totalVoters: number, myVote: Set<string> | undefined}} PollTally
 */

/**
 * Parse a kind-1068 poll rumor. Malformed option tags (missing id or label)
 * are skipped; unknown polltype values fall back to singlechoice.
 * @param {{id?: string, content?: string, tags?: string[][]}} rumor
 * @returns {ParsedPoll}
 */
export function parsePoll(rumor) {
  /** @type {PollOption[]} */
  const options = [];
  /** @type {'singlechoice'|'multiplechoice'} */
  let pollType = 'singlechoice';
  /** @type {number | undefined} */
  let endsAt;

  for (const tag of rumor.tags ?? []) {
    if (tag[0] === 'option' && tag[1] && tag[2]) {
      options.push({ id: tag[1], label: tag[2] });
    } else if (tag[0] === 'polltype' && tag[1] === 'multiplechoice') {
      pollType = 'multiplechoice';
    } else if (tag[0] === 'endsAt' && tag[1]) {
      const parsed = Number.parseInt(tag[1], 10);
      if (Number.isFinite(parsed)) endsAt = parsed;
    }
  }

  return { id: rumor.id ?? '', question: rumor.content ?? '', options, pollType, endsAt };
}

/**
 * Bucket kind-1018 vote rumors by the poll they `e`-reference, normalized to
 * {pubkey, optionIds, ms}. Rumors without an `e` target or without any
 * `response` tag are dropped. `ms` falls back to created_at seconds when the
 * rumor carries no sub-second field.
 * @param {any[]} voteRumors
 * @returns {Map<string, PollVote[]>}
 */
export function collectVotes(voteRumors) {
  const byPoll = new Map();
  for (const rumor of voteRumors) {
    const target = rumor.tags?.find((/** @type {string[]} */ t) => t[0] === 'e')?.[1];
    if (!target) continue;
    const optionIds = (rumor.tags ?? [])
      .filter((/** @type {string[]} */ [name, value]) => name === 'response' && value)
      .map((/** @type {string[]} */ [, value]) => value);
    if (optionIds.length === 0) continue;
    let list = byPoll.get(target);
    if (!list) byPoll.set(target, (list = []));
    list.push({
      pubkey: rumor.pubkey,
      optionIds,
      ms: rumor.ms ?? (rumor.created_at ?? 0) * 1000
    });
  }
  return byPoll;
}

/**
 * Deterministic tally: latest vote per pubkey wins, votes after `endsAt` are
 * ignored, undeclared option ids are dropped. Counts are per distinct voter
 * (a multi-choice voter counts once per chosen option).
 * @param {PollVote[]} votes
 * @param {PollOption[]} options
 * @param {number | undefined} endsAt
 * @param {string | undefined} selfPubkey
 * @returns {PollTally}
 */
export function tallyPollVotes(votes, options, endsAt, selfPubkey) {
  const latest = new Map();
  for (const vote of votes) {
    if (endsAt !== undefined && vote.ms / 1000 > endsAt) continue;
    const existing = latest.get(vote.pubkey);
    if (!existing || vote.ms > existing.ms) latest.set(vote.pubkey, vote);
  }

  const counts = new Map();
  const validIds = new Set(options.map((o) => o.id));
  for (const vote of latest.values()) {
    for (const optionId of new Set(
      vote.optionIds.filter((/** @type {string} */ id) => validIds.has(id))
    )) {
      counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    }
  }

  const mine = selfPubkey ? latest.get(selfPubkey) : undefined;
  return {
    counts,
    totalVoters: latest.size,
    myVote: mine ? new Set(mine.optionIds) : undefined
  };
}

/**
 * Kind-1018 vote template. The channel/epoch binding is appended by
 * community.sendEvent — never here.
 * @param {string} pollId
 * @param {string[]} optionIds
 * @returns {{kind: number, content: string, created_at: number, tags: string[][]}}
 */
export function buildVoteTemplate(pollId, optionIds) {
  return {
    kind: 1018,
    content: '',
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', pollId], ...optionIds.map((id) => ['response', id])]
  };
}

/**
 * Whether a poll with this `endsAt` (unix seconds) has closed.
 * @param {number | undefined} endsAt
 */
export function isPollEnded(endsAt) {
  return endsAt !== undefined && endsAt < Math.floor(Date.now() / 1000);
}
