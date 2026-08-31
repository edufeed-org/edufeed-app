/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parsePoll,
  collectVotes,
  tallyPollVotes,
  buildVoteTemplate,
  isPollEnded
} from '$lib/concord/polls.js';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const pollRumor = {
  id: 'poll-1',
  kind: 1068,
  pubkey: ALICE,
  content: 'Best bee?',
  created_at: 1000,
  tags: [
    ['option', 'opt-a', 'Honey bee'],
    ['option', 'opt-b', 'Bumble bee'],
    ['polltype', 'singlechoice'],
    ['endsAt', '2000']
  ]
};

/** @param {string} pubkey @param {string[]} optionIds @param {number} ms @param {string} [pollId] */
function vote(pubkey, optionIds, ms, pollId = 'poll-1') {
  return {
    id: `v-${pubkey.slice(0, 4)}-${ms}`,
    kind: 1018,
    pubkey,
    content: '',
    created_at: Math.floor(ms / 1000),
    ms,
    tags: [['e', pollId], ...optionIds.map((id) => ['response', id])]
  };
}

describe('parsePoll', () => {
  it('parses question, options, type, and endsAt', () => {
    const poll = parsePoll(pollRumor);
    expect(poll).toEqual({
      id: 'poll-1',
      question: 'Best bee?',
      options: [
        { id: 'opt-a', label: 'Honey bee' },
        { id: 'opt-b', label: 'Bumble bee' }
      ],
      pollType: 'singlechoice',
      endsAt: 2000
    });
  });

  it('defaults to singlechoice and no endsAt; skips malformed option tags', () => {
    const poll = parsePoll({
      id: 'p2',
      content: 'q',
      tags: [
        ['option', 'x'], // no label -> skipped
        ['option', 'y', 'Y label'],
        ['polltype', 'multiplechoice']
      ]
    });
    expect(poll.options).toEqual([{ id: 'y', label: 'Y label' }]);
    expect(poll.pollType).toBe('multiplechoice');
    expect(poll.endsAt).toBeUndefined();
  });
});

describe('collectVotes', () => {
  it('buckets kind-1018 rumors by their e-target, normalizing to {pubkey, optionIds, ms}', () => {
    const votes = [
      vote(ALICE, ['opt-a'], 1500_000),
      vote(BOB, ['opt-b'], 1600_000),
      vote(BOB, ['opt-a'], 1400_000, 'other-poll'),
      { kind: 1018, pubkey: BOB, tags: [['e', 'poll-1']] } // no response tags -> dropped
    ];
    const byPoll = collectVotes(votes);
    expect([...byPoll.keys()].sort()).toEqual(['other-poll', 'poll-1']);
    expect(byPoll.get('poll-1')).toEqual([
      { pubkey: ALICE, optionIds: ['opt-a'], ms: 1500_000 },
      { pubkey: BOB, optionIds: ['opt-b'], ms: 1600_000 }
    ]);
  });

  it('falls back to created_at*1000 when a rumor has no ms field', () => {
    const noMs = {
      kind: 1018,
      pubkey: ALICE,
      created_at: 1500,
      tags: [
        ['e', 'poll-1'],
        ['response', 'opt-a']
      ]
    };
    expect(collectVotes([noMs]).get('poll-1')?.[0].ms).toBe(1500_000);
  });
});

describe('tallyPollVotes', () => {
  const options = [
    { id: 'opt-a', label: 'A' },
    { id: 'opt-b', label: 'B' }
  ];

  it('latest vote per pubkey wins; counts are per distinct voter', () => {
    const tally = tallyPollVotes(
      [
        { pubkey: ALICE, optionIds: ['opt-a'], ms: 1100_000 },
        { pubkey: ALICE, optionIds: ['opt-b'], ms: 1200_000 }, // supersedes
        { pubkey: BOB, optionIds: ['opt-b'], ms: 1150_000 }
      ],
      options,
      undefined,
      ALICE
    );
    expect(tally.counts.get('opt-a')).toBeUndefined();
    expect(tally.counts.get('opt-b')).toBe(2);
    expect(tally.totalVoters).toBe(2);
    expect(tally.myVote).toEqual(new Set(['opt-b']));
  });

  it('ignores votes cast after endsAt and responses naming undeclared options', () => {
    const tally = tallyPollVotes(
      [
        { pubkey: ALICE, optionIds: ['opt-a', 'bogus'], ms: 1500_000 },
        { pubkey: BOB, optionIds: ['opt-b'], ms: 2500_000 } // after endsAt=2000s
      ],
      options,
      2000,
      undefined
    );
    expect(tally.counts.get('opt-a')).toBe(1);
    expect(tally.counts.get('bogus')).toBeUndefined();
    expect(tally.counts.get('opt-b')).toBeUndefined();
    expect(tally.totalVoters).toBe(1);
    expect(tally.myVote).toBeUndefined();
  });
});

describe('buildVoteTemplate', () => {
  it('builds a kind-1018 template e-tagging the poll with one response tag per option', () => {
    const template = buildVoteTemplate('poll-1', ['opt-a', 'opt-b']);
    expect(template.kind).toBe(1018);
    expect(template.content).toBe('');
    expect(typeof template.created_at).toBe('number');
    expect(template.tags).toEqual([
      ['e', 'poll-1'],
      ['response', 'opt-a'],
      ['response', 'opt-b']
    ]);
  });
});

describe('isPollEnded', () => {
  it('is true only for a past endsAt', () => {
    expect(isPollEnded(undefined)).toBe(false);
    expect(isPollEnded(Math.floor(Date.now() / 1000) + 3600)).toBe(false);
    expect(isPollEnded(Math.floor(Date.now() / 1000) - 3600)).toBe(true);
  });
});

// PollMessage keys its {#each} by option.id; a rumor repeating an option tag
// (untrusted network input) must not crash every viewer with
// each_key_duplicate. First occurrence wins.
describe('parsePoll — duplicate option ids', () => {
  it('keeps only the first option per id', () => {
    const poll = parsePoll({
      id: 'p1',
      content: 'q?',
      tags: [
        ['option', 'x', 'first'],
        ['option', 'x', 'second'],
        ['option', 'y', 'other']
      ]
    });
    expect(poll.options).toEqual([
      { id: 'x', label: 'first' },
      { id: 'y', label: 'other' }
    ]);
  });
});
