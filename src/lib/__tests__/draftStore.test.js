// @ts-nocheck
/**
 * draftStore — wizard draft persistence (localStorage-backed).
 *
 * Persists in-progress resource form data so that an accidental refresh /
 * tab close / navigation does not lose the user's work. One slot per
 * variantId. Edit-mode flows opt out by simply not calling save/load.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadDraft, saveDraft, clearDraft } from '../helpers/educational/draftStore.js';

/** Minimal in-memory Storage shim implementing the Web Storage API. */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    _map: map
  };
}

/** Storage that throws on writes (simulates quota / private mode). */
function makeBrokenStorage() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
    clear: () => {},
    length: 0,
    key: () => null
  };
}

describe('draftStore', () => {
  let storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('loadDraft returns null when no draft has been saved for this variant', () => {
    expect(loadDraft('amb', storage)).toBeNull();
  });

  it('saveDraft then loadDraft round-trips formData and includes savedAt', () => {
    const formData = { name: 'Bruchrechnen', description: 'Eine Einführung' };
    saveDraft('amb', formData, {}, storage);

    const loaded = loadDraft('amb', storage);
    expect(loaded).not.toBeNull();
    expect(loaded.formData).toEqual(formData);
    expect(typeof loaded.savedAt).toBe('number');
    expect(loaded.savedAt).toBeGreaterThan(0);
  });

  it('clearDraft removes the draft so subsequent loadDraft returns null', () => {
    saveDraft('amb', { name: 'X' }, {}, storage);
    clearDraft('amb', storage);
    expect(loadDraft('amb', storage)).toBeNull();
  });

  it('keeps drafts for different variantIds in separate slots', () => {
    saveDraft('amb', { name: 'AMB resource' }, {}, storage);
    saveDraft('ekw', { name: 'EKW resource' }, {}, storage);

    expect(loadDraft('amb', storage).formData.name).toBe('AMB resource');
    expect(loadDraft('ekw', storage).formData.name).toBe('EKW resource');

    clearDraft('amb', storage);
    expect(loadDraft('amb', storage)).toBeNull();
    expect(loadDraft('ekw', storage).formData.name).toBe('EKW resource');
  });

  it('loadDraft returns null when the stored value is corrupted JSON', () => {
    // Simulate a stored entry that was tampered with or partially written.
    storage.setItem('comcal.resourceDraft.amb', '{not json');
    expect(loadDraft('amb', storage)).toBeNull();
  });

  it('loadDraft returns null when the stored value is missing the formData field', () => {
    storage.setItem('comcal.resourceDraft.amb', JSON.stringify({ savedAt: 123 }));
    expect(loadDraft('amb', storage)).toBeNull();
  });

  it('saveDraft swallows storage errors (quota, private mode) without throwing', () => {
    const broken = makeBrokenStorage();
    expect(() => saveDraft('amb', { name: 'X' }, {}, broken)).not.toThrow();
  });

  it('returns null and does not throw when storage is undefined (SSR / no window)', () => {
    expect(loadDraft('amb', undefined)).toBeNull();
    expect(() => saveDraft('amb', { name: 'X' }, {}, undefined)).not.toThrow();
    expect(() => clearDraft('amb', undefined)).not.toThrow();
  });

  it('overwrites an older draft when saveDraft is called again for the same variant', () => {
    saveDraft('amb', { name: 'first' }, {}, storage);
    saveDraft('amb', { name: 'second' }, {}, storage);
    expect(loadDraft('amb', storage).formData.name).toBe('second');
  });

  it('round-trips extras (sibling state stored outside formData)', () => {
    const formData = { name: 'Bruchrechnen' };
    const extras = {
      aboutByVocab: { schulfaecher: [{ id: 'urn:subj:math', label: 'Mathematik' }] },
      selectedCommunityPubkeys: ['abc123', 'def456'],
      hasNoUrl: true
    };
    saveDraft('amb', formData, extras, storage);

    const loaded = loadDraft('amb', storage);
    expect(loaded.formData).toEqual(formData);
    expect(loaded.extras).toEqual(extras);
  });

  it('loadDraft returns an empty extras object for legacy drafts saved without extras', () => {
    // Simulate a draft written by an older app version (no extras key).
    storage.setItem(
      'comcal.resourceDraft.amb',
      JSON.stringify({ formData: { name: 'X' }, savedAt: 123 })
    );
    const loaded = loadDraft('amb', storage);
    expect(loaded.formData).toEqual({ name: 'X' });
    expect(loaded.extras).toEqual({});
  });

  it('saveDraft tolerates a missing extras argument (defaults to empty object)', () => {
    saveDraft('amb', { name: 'X' }, undefined, storage);
    expect(loadDraft('amb', storage).extras).toEqual({});
  });
});
