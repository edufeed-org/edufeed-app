/** @vitest-environment node */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  massageURL,
  defaultThreshold,
  decodeGoogleToken,
  buildBunkerUrl,
  operatorToken
} from '../services/pomegranate.js';

/** Build a base64 token like the central server posts back. */
function makeRawToken({ createdAtSec, email }) {
  return btoa(JSON.stringify({ created_at: createdAtSec, tags: email ? [['email', email]] : [] }));
}

describe('pomegranate pure helpers', () => {
  it('massageURL normalizes to origin', () => {
    expect(massageURL('https://auth.njump.me/')).toBe('https://auth.njump.me');
    expect(massageURL('auth.njump.me')).toBe('https://auth.njump.me');
    expect(massageURL(' https://po.f7z.io/some/path ')).toBe('https://po.f7z.io');
    expect(massageURL('localhost:8080')).toBe('http://localhost:8080');
  });

  it('defaultThreshold is ceil(7n/12)', () => {
    expect(defaultThreshold(5)).toBe(3);
    expect(defaultThreshold(2)).toBe(2);
    expect(defaultThreshold(3)).toBe(2);
    expect(defaultThreshold(12)).toBe(7);
  });

  it('decodeGoogleToken extracts email and createdAt', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const raw = makeRawToken({ createdAtSec: nowSec, email: 'a@b.c' });
    const token = decodeGoogleToken(raw);
    expect(token.email).toBe('a@b.c');
    expect(token.raw).toBe(raw);
    expect(token.createdAt).toBe(nowSec * 1000);
  });

  it('decodeGoogleToken rejects expired (>24h) tokens', () => {
    const oldSec = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    expect(() => decodeGoogleToken(makeRawToken({ createdAtSec: oldSec, email: 'a@b.c' }))).toThrow(
      /expired/
    );
  });

  it('decodeGoogleToken rejects garbage', () => {
    expect(() => decodeGoogleToken('not-base64-json')).toThrow(/Invalid/);
  });

  it('buildBunkerUrl swaps scheme to ws and encodes the relay', () => {
    expect(buildBunkerUrl('https://auth.njump.me', { handler_pubkey: 'ab'.repeat(32) })).toBe(
      `bunker://${'ab'.repeat(32)}?relay=${encodeURIComponent('wss://auth.njump.me')}`
    );
  });

  it('operatorToken is a 64-char hex digest and varies by input', async () => {
    const t1 = await operatorToken('session-a', 'https://op1');
    const t2 = await operatorToken('session-a', 'https://op2');
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });
});
