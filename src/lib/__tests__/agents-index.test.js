/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { indexAgents, indexAgentRecords, presenceIsOnline } from '$lib/agents/agent-index.js';
import { buildPersonaTemplate, buildAgentRecordTemplate } from '$lib/agents/persona.js';

const OWNER = 'a'.repeat(64);
const A1 = 'b'.repeat(64);
const A2 = 'c'.repeat(64);

const rec = (agent, name, definition, created_at = 1) => ({
  ...buildAgentRecordTemplate({ agentPubkey: agent, name, definition, respondTo: 'anyone' }),
  pubkey: OWNER,
  id: agent + created_at,
  created_at
});
const per = (slug, name) => ({
  ...buildPersonaTemplate({
    slug,
    displayName: name,
    systemPrompt: '',
    runtime: 'claude',
    avatarUrl: null,
    respondTo: 'owner-only'
  }),
  pubkey: OWNER,
  id: slug
});

describe('indexAgents', () => {
  it('joins records to personas by definition slug and sorts by name', () => {
    const agents = indexAgents(
      [rec(A2, 'Zeta', 'zeta'), rec(A1, 'Alpha', 'alpha')],
      [per('alpha', 'Alpha'), per('zeta', 'Zeta')]
    );
    expect(agents.map((a) => a.name)).toEqual(['Alpha', 'Zeta']);
    expect(agents[0]).toMatchObject({
      agentPubkey: A1,
      ownerPubkey: OWNER,
      respondTo: 'anyone',
      persona: { slug: 'alpha' }
    });
  });
  it('keeps a record whose persona is missing and dedupes by agent pubkey keeping the newest', () => {
    const agents = indexAgents([rec(A1, 'Old', 'alpha', 1), rec(A1, 'New', 'alpha', 2)], []);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('New');
    expect(agents[0].persona).toBeNull();
  });
  it('ignores events that do not parse', () => {
    expect(
      indexAgents([{ kind: 30177, pubkey: OWNER, tags: [['d', 'nope']], content: '{}' }], [])
    ).toEqual([]);
  });
});

describe('indexAgentRecords', () => {
  it('maps agent pubkey to owner and name', () => {
    const map = indexAgentRecords([rec(A1, 'Alpha', 'alpha')]);
    expect(map.get(A1)).toEqual({ ownerPubkey: OWNER, name: 'Alpha' });
  });
});

describe('presenceIsOnline', () => {
  it('is online only for a recent "online" or "away"', () => {
    expect(presenceIsOnline({ status: 'online', at: 1000 }, 1000 + 299)).toBe(true);
    expect(presenceIsOnline({ status: 'away', at: 1000 }, 1000 + 10)).toBe(true);
    expect(presenceIsOnline({ status: 'online', at: 1000 }, 1000 + 301)).toBe(false);
    expect(presenceIsOnline({ status: 'offline', at: 1000 }, 1001)).toBe(false);
    expect(presenceIsOnline(undefined, 1)).toBe(false);
  });
});
