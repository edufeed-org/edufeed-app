/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { publishAgent, removeAgent } from '$lib/agents/agent-publish.js';

const OWNER = 'a'.repeat(64);
const AGENT = 'b'.repeat(64);
const user = {
  pubkey: OWNER,
  signer: { signEvent: vi.fn(async (t) => ({ ...t, id: 'id-' + t.kind, sig: 'sig' })) }
};
const persona = {
  slug: 'lehrbot',
  displayName: 'Lehrbot',
  systemPrompt: 'Hilf.',
  runtime: 'claude',
  avatarUrl: null,
  respondTo: 'owner-only'
};
const record = {
  agentPubkey: AGENT,
  name: 'Lehrbot',
  definition: 'lehrbot',
  respondTo: 'owner-only'
};

/** @param {string | null} [rejectGroupId] */
function fakeDeps(rejectGroupId = null) {
  /** @type {Array<{relay: string, template: any}>} */
  const published = [];
  const publish = vi.fn(async (relayConn, template) => {
    published.push({ relay: relayConn.url, template });
    const h = template.tags.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
    if (rejectGroupId && h === rejectGroupId) throw new Error('blocked: unknown member');
    return { ...template, id: 'signed', pubkey: OWNER, sig: 'sig' };
  });
  return {
    deps: {
      /** @param {string} url */
      relayFor: (url) => ({ url }),
      relays: ['wss://groups.example'],
      publish
    },
    published
  };
}

describe('publishAgent', () => {
  it('publishes record, persona and one 9000 per group, in that order', async () => {
    const { deps, published } = fakeDeps();
    const result = await publishAgent(
      {
        user,
        persona,
        record,
        addToGroups: [{ id: 'g1', relay: 'wss://groups.example' }],
        removeFromGroups: []
      },
      deps
    );
    expect(published.map((p) => p.template.kind)).toEqual([30177, 30175, 9000]);
    expect(published[2].template.tags).toEqual([
      ['h', 'g1'],
      ['p', AGENT]
    ]);
    expect(result.failedGroups).toEqual([]);
    expect(result.recordEvent.kind).toBe(30177);
  });

  it('collects a rejected 9000 instead of failing the whole save', async () => {
    const { deps } = fakeDeps('g2');
    const result = await publishAgent(
      {
        user,
        persona,
        record,
        addToGroups: [
          { id: 'g1', relay: 'wss://groups.example' },
          { id: 'g2', relay: 'wss://groups.example' }
        ],
        removeFromGroups: []
      },
      deps
    );
    expect(result.failedGroups).toEqual([
      { id: 'g2', relay: 'wss://groups.example', error: 'blocked: unknown member' }
    ]);
  });

  it('sends a 9001 for groups to leave', async () => {
    const { deps, published } = fakeDeps();
    await publishAgent(
      {
        user,
        persona,
        record,
        addToGroups: [],
        removeFromGroups: [{ id: 'g3', relay: 'wss://groups.example' }]
      },
      deps
    );
    expect(published.at(-1)?.template.kind).toBe(9001);
    expect(published.at(-1)?.template.tags).toEqual([
      ['h', 'g3'],
      ['p', AGENT]
    ]);
  });

  it('publishes the records to every groups relay and throws only if all reject', async () => {
    const publish = vi.fn(async (relayConn, template) => {
      if (relayConn.url === 'wss://a' && template.kind !== 9000) throw new Error('down');
      return { ...template, id: 'x', pubkey: OWNER, sig: 's' };
    });
    const deps = {
      /** @param {string} url */
      relayFor: (url) => ({ url }),
      relays: ['wss://a', 'wss://b'],
      publish
    };
    const ok = await publishAgent(
      { user, persona, record, addToGroups: [], removeFromGroups: [] },
      deps
    );
    expect(ok.recordEvent).toBeTruthy();

    const allDown = {
      ...deps,
      publish: vi.fn(async () => {
        throw new Error('down');
      })
    };
    await expect(
      publishAgent({ user, persona, record, addToGroups: [], removeFromGroups: [] }, allDown)
    ).rejects.toThrow('down');
  });
});

describe('removeAgent', () => {
  it('sends the 9001s first, then the deletion, and reports failed groups', async () => {
    const { deps, published } = fakeDeps('g2');
    const result = await removeAgent(
      {
        user,
        agentPubkey: AGENT,
        slug: 'lehrbot',
        groups: [
          { id: 'g1', relay: 'wss://groups.example' },
          { id: 'g2', relay: 'wss://groups.example' }
        ]
      },
      deps
    );
    expect(published.map((p) => p.template.kind)).toEqual([9001, 9001, 5]);
    expect(result.failedGroups.map((g) => g.id)).toEqual(['g2']);
    expect(result.deletionEvent.tags).toEqual([
      ['a', `30177:${OWNER}:${AGENT}`],
      ['a', `30175:${OWNER}:lehrbot`]
    ]);
  });
});
