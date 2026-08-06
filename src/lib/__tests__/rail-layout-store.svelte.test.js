/** @vitest-environment jsdom */
/**
 * The rail layout store. What matters here is the failure behaviour: a rail
 * that loses a user's communities because a saved value went bad is worse than
 * one that loses their arrangement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readRailLayout,
  writeRailLayout,
  readOpenFolders,
  writeOpenFolders,
  nextFolderId
} from '$lib/rail/rail-layout-store.svelte.js';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

beforeEach(() => localStorage.clear());

describe('readRailLayout / writeRailLayout', () => {
  it('round-trips an arrangement', () => {
    const layout = [
      { type: 'folder', id: 'f1', name: 'Schule', keys: ['community:x'] },
      { type: 'item', key: 'area:y' }
    ];
    writeRailLayout(ME, /** @type {any} */ (layout));
    expect(readRailLayout(ME)).toEqual(layout);
  });

  // Two accounts on one device must not inherit each other's rail — their
  // containers are not even the same set.
  it('keeps accounts apart', () => {
    writeRailLayout(ME, /** @type {any} */ ([{ type: 'item', key: 'community:x' }]));
    expect(readRailLayout(OTHER)).toEqual([]);
  });

  it('is empty rather than throwing for a value that will not parse', () => {
    localStorage.setItem(`rail-layout:${ME}`, '{ not json');
    expect(readRailLayout(ME)).toEqual([]);
  });

  it('does nothing at all without an account', () => {
    writeRailLayout(null, /** @type {any} */ ([{ type: 'item', key: 'community:x' }]));
    expect(localStorage.length).toBe(0);
    expect(readRailLayout(null)).toEqual([]);
  });
});

describe('readOpenFolders / writeOpenFolders', () => {
  it('round-trips the open set', () => {
    writeOpenFolders(ME, ['f1', 'f2']);
    expect([...readOpenFolders(ME)].sort()).toEqual(['f1', 'f2']);
  });

  it('ignores entries that are not folder ids', () => {
    localStorage.setItem(`rail-open-folders:${ME}`, JSON.stringify(['f1', 7, null, { id: 'f2' }]));
    expect([...readOpenFolders(ME)]).toEqual(['f1']);
  });

  // Open/closed is per device. Storing it under a separate key is what keeps
  // it out of the arrangement, so a device that has never opened a folder
  // still gets the arrangement.
  it('is stored apart from the arrangement', () => {
    writeRailLayout(ME, /** @type {any} */ ([{ type: 'item', key: 'community:x' }]));
    writeOpenFolders(ME, ['f1']);
    localStorage.removeItem(`rail-open-folders:${ME}`);
    expect(readRailLayout(ME)).toHaveLength(1);
  });
});

describe('nextFolderId', () => {
  it('never reuses an id already in the layout', () => {
    const layout = /** @type {any} */ ([
      { type: 'folder', id: 'f1', name: 'A', keys: ['x'] },
      { type: 'item', key: 'y' },
      { type: 'folder', id: 'f2', name: 'B', keys: ['z'] }
    ]);
    expect(nextFolderId(layout)).toBe('f3');
  });

  it('fills a gap left by a dissolved folder', () => {
    const layout = /** @type {any} */ ([{ type: 'folder', id: 'f2', name: 'B', keys: ['z'] }]);
    expect(nextFolderId(layout)).toBe('f1');
  });

  it('starts at f1 for an empty rail', () => {
    expect(nextFolderId([])).toBe('f1');
  });
});
