/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildEnvelope, validateEnvelope } from '$lib/cordn/envelope.js';

const PUBKEY = 'a'.repeat(64);
const OTHER_PUBKEY = 'b'.repeat(64);

describe('buildEnvelope (Cordn spec/02)', () => {
  it('builds an unsigned kind-9 envelope with NIP-01 id and no sig field', () => {
    const env = buildEnvelope({ pubkey: PUBKEY, content: 'hallo', created_at: 1700000000 });
    expect(env.kind).toBe(9);
    expect(env.pubkey).toBe(PUBKEY);
    expect(env.content).toBe('hallo');
    expect(env.tags).toEqual([]);
    expect(env.id).toMatch(/^[0-9a-f]{64}$/);
    expect('sig' in env).toBe(false);
  });

  it('derives a stable id from the NIP-01 serialization', () => {
    const a = buildEnvelope({ pubkey: PUBKEY, content: 'x', created_at: 1700000000 });
    const b = buildEnvelope({ pubkey: PUBKEY, content: 'x', created_at: 1700000000 });
    expect(a.id).toBe(b.id);
    const c = buildEnvelope({ pubkey: PUBKEY, content: 'y', created_at: 1700000000 });
    expect(c.id).not.toBe(a.id);
  });

  it('supports custom kind and tags (NIP-22 replies)', () => {
    const env = buildEnvelope({
      pubkey: PUBKEY,
      kind: 1111,
      content: 'reply',
      tags: [['e', 'c'.repeat(64)]],
      created_at: 1700000001
    });
    expect(env.kind).toBe(1111);
    expect(env.tags).toEqual([['e', 'c'.repeat(64)]]);
  });
});

describe('validateEnvelope (Cordn spec/02 §4–5)', () => {
  const valid = () => buildEnvelope({ pubkey: PUBKEY, content: 'ok', created_at: 1700000000 });
  /**
   * @param {Record<string, unknown>} envelope
   * @param {string} sender
   * @returns {{valid: boolean, reason?: string}}
   */
  const check = (envelope, sender) => validateEnvelope(envelope, sender);

  it('accepts an envelope whose id matches and whose pubkey equals the MLS sender', () => {
    expect(validateEnvelope(valid(), PUBKEY)).toEqual({ valid: true });
  });

  it('rejects an envelope with a tampered id', () => {
    const env = { ...valid(), id: 'f'.repeat(64) };
    const res = check(env, PUBKEY);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/id/i);
  });

  it('rejects tampered content (id no longer matches)', () => {
    const env = { ...valid(), content: 'evil' };
    expect(validateEnvelope(env, PUBKEY).valid).toBe(false);
  });

  it('rejects an envelope whose pubkey differs from the authenticated MLS sender', () => {
    const res = check(valid(), OTHER_PUBKEY);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/sender/i);
  });

  it('rejects an envelope carrying a sig field', () => {
    const env = { ...valid(), sig: '00'.repeat(64) };
    const res = check(env, PUBKEY);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/sig/i);
  });

  it('rejects envelopes missing required fields', () => {
    const { created_at: _omitted, ...withoutCreatedAt } = valid();
    expect(check(withoutCreatedAt, PUBKEY).valid).toBe(false);
  });
});
