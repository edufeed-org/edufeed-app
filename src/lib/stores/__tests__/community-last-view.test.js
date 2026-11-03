/** @vitest-environment node */
// Per-device memory of the last opened section of a community (and the visit
// time), feeding the phone Communities list's row targets and "neu" badges.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAST_VIEW_KEY,
  LAST_VIEW_MAX,
  LAST_VIEW_TTL_SECONDS,
  isRememberableView,
  readCommunityView,
  rememberCommunityView
} from '../community-last-view.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** @returns {Storage} */
function memoryStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, String(v)),
    removeItem: (/** @type {string} */ k) => void map.delete(k)
  });
}

/** @type {Storage} */
let mem;
beforeEach(() => {
  mem = memoryStorage();
});

describe('isRememberableView', () => {
  it('accepts content sections, rejects settings and members and junk', () => {
    expect(isRememberableView('calendar')).toBe(true);
    expect(isRememberableView('channels')).toBe(true);
    expect(isRememberableView('home')).toBe(true);
    expect(isRememberableView('settings')).toBe(false);
    expect(isRememberableView('members')).toBe(false);
    expect(isRememberableView('nope')).toBe(false);
  });
});

describe('rememberCommunityView / readCommunityView', () => {
  it('remembers a content view and the visit time', () => {
    rememberCommunityView(A, 'calendar', 1000, mem);
    expect(readCommunityView(A, 1000, mem)).toEqual({ view: 'calendar', at: 1000 });
    expect(readCommunityView(B, 1000, mem)).toBeNull();
  });

  it('refreshes the time but keeps the previous view for settings/members', () => {
    rememberCommunityView(A, 'channels', 1000, mem);
    rememberCommunityView(A, 'settings', 2000, mem);
    expect(readCommunityView(A, 2000, mem)).toEqual({ view: 'channels', at: 2000 });
  });

  it('a settings-only visit still records the time with home as the view', () => {
    rememberCommunityView(B, 'members', 500, mem);
    expect(readCommunityView(B, 500, mem)).toEqual({ view: 'home', at: 500 });
  });

  it('expires entries after 90 days', () => {
    rememberCommunityView(A, 'calendar', 1000, mem);
    expect(readCommunityView(A, 1000 + LAST_VIEW_TTL_SECONDS - 1, mem)).not.toBeNull();
    expect(readCommunityView(A, 1000 + LAST_VIEW_TTL_SECONDS + 1, mem)).toBeNull();
  });

  it('caps the map at LAST_VIEW_MAX entries, dropping the oldest', () => {
    for (let i = 0; i < LAST_VIEW_MAX + 1; i++) {
      rememberCommunityView(String(i).padStart(64, '0'), 'chat', 1000 + i, mem);
    }
    expect(readCommunityView(String(0).padStart(64, '0'), 5000, mem)).toBeNull();
    expect(readCommunityView(String(LAST_VIEW_MAX).padStart(64, '0'), 5000, mem)).not.toBeNull();
  });

  it('tolerates garbage in storage and a storage that throws', () => {
    mem.setItem(LAST_VIEW_KEY, '{not json');
    expect(readCommunityView(A, 1, mem)).toBeNull();
    rememberCommunityView(A, 'calendar', 2, mem);
    expect(readCommunityView(A, 2, mem)).toEqual({ view: 'calendar', at: 2 });
    const broken = /** @type {any} */ ({
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      }
    });
    expect(() => rememberCommunityView(A, 'calendar', 3, broken)).not.toThrow();
    expect(readCommunityView(A, 3, broken)).toBeNull();
  });
});
