/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildPointerUpdate } from '$lib/concord/founding.js';

const CID = 'c'.repeat(64);

describe('buildPointerUpdate', () => {
  it('produces an unsigned 10222 template preserving tags/content, adding the pointer', () => {
    const communikeyEvent = {
      kind: 10222,
      pubkey: 'a'.repeat(64),
      created_at: 1000,
      content: 'community definition',
      tags: [
        ['r', 'wss://x'],
        ['content', 'chat']
      ]
    };
    const template = buildPointerUpdate(communikeyEvent, CID, 'wss://concord.example');
    expect(template.kind).toBe(10222);
    expect(template.content).toBe('community definition');
    expect(template.tags).toContainEqual(['r', 'wss://x']);
    expect(template.tags).toContainEqual(['concord', CID, 'wss://concord.example']);
    expect(template.created_at).toBeGreaterThan(1000);
    expect(template).not.toHaveProperty('id');
    expect(template).not.toHaveProperty('sig');
  });

  it('replaces an existing pointer instead of duplicating', () => {
    const event = {
      kind: 10222,
      pubkey: 'a'.repeat(64),
      created_at: 1,
      content: '',
      tags: [['concord', 'b'.repeat(64)]]
    };
    const template = buildPointerUpdate(event, CID);
    expect(template.tags.filter((t) => t[0] === 'concord')).toEqual([['concord', CID]]);
  });
});
