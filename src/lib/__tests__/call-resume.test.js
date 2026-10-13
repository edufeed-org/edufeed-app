// @ts-nocheck
/** @vitest-environment node */
/**
 * call-resume.js — the note of the call this tab is in, kept in
 * sessionStorage for the "Zurück in den Anruf" offer after a reload.
 */
import { describe, it, expect } from 'vitest';
import {
  rememberCall,
  forgetCall,
  readResumableCall,
  CALL_RESUME_KEY,
  CALL_RESUME_MAX_AGE_MS
} from '$lib/groups/call-resume.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map
  };
}

const pointer = { id: 'g1', relay: 'wss://groups.example/' };

describe('call-resume', () => {
  it('remembers the call with when, and reads it back while it is young', () => {
    const storage = fakeStorage();
    rememberCall({ pointer, title: 'Seminar', href: '/c/x', code: null }, 1000, storage);
    expect(JSON.parse(storage.getItem(CALL_RESUME_KEY)).at).toBe(1000);
    expect(readResumableCall(1000 + CALL_RESUME_MAX_AGE_MS, storage)).toEqual({
      pointer,
      title: 'Seminar',
      href: '/c/x',
      code: null,
      at: 1000
    });
    expect(readResumableCall(1000 + CALL_RESUME_MAX_AGE_MS + 1, storage)).toBeNull();
  });

  it('keeps a guest code for the way back', () => {
    const storage = fakeStorage();
    rememberCall({ pointer, code: 'C'.repeat(22) }, 5, storage);
    expect(readResumableCall(10, storage)?.code).toBe('C'.repeat(22));
    expect(readResumableCall(10, storage)?.title).toBe('');
  });

  it('forgets on request, and ignores garbage, a note from the future, or no storage', () => {
    const storage = fakeStorage();
    rememberCall({ pointer }, 1, storage);
    forgetCall(storage);
    expect(readResumableCall(2, storage)).toBeNull();
    expect(readResumableCall(2, fakeStorage({ [CALL_RESUME_KEY]: '{nope' }))).toBeNull();
    expect(
      readResumableCall(2, fakeStorage({ [CALL_RESUME_KEY]: JSON.stringify({ at: 2 }) }))
    ).toBeNull();
    expect(
      readResumableCall(
        2,
        fakeStorage({ [CALL_RESUME_KEY]: JSON.stringify({ pointer, at: 2 + 120_000 }) })
      )
    ).toBeNull();
    expect(readResumableCall(2, null)).toBeNull();
    expect(() => rememberCall({ pointer }, 1, null)).not.toThrow();
    expect(() => forgetCall(null)).not.toThrow();
  });

  it('a storage that throws is as good as none', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      }
    };
    expect(() => rememberCall({ pointer }, 1, broken)).not.toThrow();
    expect(readResumableCall(1, broken)).toBeNull();
    expect(() => forgetCall(broken)).not.toThrow();
  });
});
