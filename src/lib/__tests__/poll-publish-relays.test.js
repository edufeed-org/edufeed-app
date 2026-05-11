/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { extractPollRelayTags } from '$lib/helpers/polls.js';

describe('extractPollRelayTags', () => {
  it('returns the values of all relay tags from a poll event', () => {
    const poll = {
      tags: [
        ['option', 'a', 'A'],
        ['relay', 'wss://relay.damus.io/'],
        ['relay', 'wss://nos.lol/'],
        ['polltype', 'singlechoice']
      ]
    };
    expect(extractPollRelayTags(poll)).toEqual(['wss://relay.damus.io/', 'wss://nos.lol/']);
  });

  it('returns an empty array when the poll has no relay tags', () => {
    expect(extractPollRelayTags({ tags: [] })).toEqual([]);
  });

  it('ignores relay tags with non-string values', () => {
    const poll = { tags: [['relay', 'wss://ok'], ['relay'], ['relay', null]] };
    expect(extractPollRelayTags(poll)).toEqual(['wss://ok']);
  });
});
