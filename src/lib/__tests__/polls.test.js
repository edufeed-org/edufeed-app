/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { tallyPollVotes, generateOptionId } from '$lib/helpers/polls.js';

/** @returns {any} */
function poll({ id = 'pollid', options, polltype = 'singlechoice', endsAt } = {}) {
  const tags = options.map((o) => ['option', o.id, o.label]);
  tags.push(['polltype', polltype]);
  if (endsAt) tags.push(['endsAt', String(endsAt)]);
  return { id, kind: 1068, pubkey: 'author', content: 'Q', created_at: 1, tags };
}

/** @returns {any} */
function vote({ pubkey, options, created_at, pollId = 'pollid', id }) {
  return {
    id: id || `${pubkey}-${created_at}`,
    kind: 1018,
    pubkey,
    created_at,
    tags: [['e', pollId], ...options.map((o) => ['response', o])],
    content: ''
  };
}

describe('tallyPollVotes', () => {
  const p = poll({
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' }
    ]
  });

  it('returns empty tally for no responses', () => {
    const t = tallyPollVotes(p, []);
    expect(t.totalVoters).toBe(0);
    expect(t.byOption.get('a')?.count).toBe(0);
    expect(t.userVote).toBeNull();
  });

  it('counts single-choice votes per option', () => {
    const responses = [
      vote({ pubkey: 'u1', options: ['a'], created_at: 10 }),
      vote({ pubkey: 'u2', options: ['a'], created_at: 11 }),
      vote({ pubkey: 'u3', options: ['b'], created_at: 12 })
    ];
    const t = tallyPollVotes(p, responses);
    expect(t.byOption.get('a').count).toBe(2);
    expect(t.byOption.get('b').count).toBe(1);
    expect(t.byOption.get('c').count).toBe(0);
    expect(t.totalVoters).toBe(3);
  });

  it('rejects single-choice votes with multiple response tags', () => {
    const responses = [vote({ pubkey: 'u1', options: ['a', 'b'], created_at: 10 })];
    const t = tallyPollVotes(p, responses);
    expect(t.byOption.get('a').count).toBe(0);
    expect(t.byOption.get('b').count).toBe(0);
    expect(t.totalVoters).toBe(0);
  });

  it('counts multi-choice across all distinct response tags', () => {
    const multi = poll({
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' }
      ],
      polltype: 'multiplechoice'
    });
    const responses = [vote({ pubkey: 'u1', options: ['a', 'b'], created_at: 10 })];
    const t = tallyPollVotes(multi, responses);
    expect(t.byOption.get('a').count).toBe(1);
    expect(t.byOption.get('b').count).toBe(1);
    expect(t.totalVoters).toBe(1);
  });

  it('keeps only the latest vote per pubkey (latest-wins)', () => {
    const responses = [
      vote({ pubkey: 'u1', options: ['a'], created_at: 10 }),
      vote({ pubkey: 'u1', options: ['b'], created_at: 20 })
    ];
    const t = tallyPollVotes(p, responses);
    expect(t.byOption.get('a').count).toBe(0);
    expect(t.byOption.get('b').count).toBe(1);
  });

  it('drops responses after endsAt', () => {
    const closing = poll({
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' }
      ],
      endsAt: 100
    });
    const responses = [
      vote({ pubkey: 'u1', options: ['a'], created_at: 50 }),
      vote({ pubkey: 'u2', options: ['a'], created_at: 200 })
    ];
    const t = tallyPollVotes(closing, responses);
    expect(t.byOption.get('a').count).toBe(1);
    expect(t.totalVoters).toBe(1);
  });

  it('drops responses with option ids not in the poll', () => {
    const responses = [vote({ pubkey: 'u1', options: ['z'], created_at: 10 })];
    const t = tallyPollVotes(p, responses);
    expect(t.totalVoters).toBe(0);
  });

  it('breaks created_at ties deterministically by event id', () => {
    const responses = [
      vote({ id: 'xxx', pubkey: 'u1', options: ['a'], created_at: 10 }),
      vote({ id: 'aaa', pubkey: 'u1', options: ['b'], created_at: 10 })
    ];
    // 'xxx' > 'aaa', so 'xxx' (option a) wins
    const t = tallyPollVotes(p, responses);
    expect(t.byOption.get('a').count).toBe(1);
    expect(t.byOption.get('b').count).toBe(0);
  });

  it('returns userVote when activeUser pubkey matches', () => {
    const responses = [vote({ pubkey: 'u1', options: ['a'], created_at: 10 })];
    const t = tallyPollVotes(p, responses, 'u1');
    expect(t.userVote).toEqual(['a']);
  });

  it('returns userVote = null when activeUser has not voted', () => {
    const responses = [vote({ pubkey: 'u1', options: ['a'], created_at: 10 })];
    const t = tallyPollVotes(p, responses, 'u2');
    expect(t.userVote).toBeNull();
  });
});

describe('generateOptionId', () => {
  it('generates 9-char base36 ids', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateOptionId();
      expect(id).toMatch(/^[a-z0-9]{9}$/);
    }
  });
});
