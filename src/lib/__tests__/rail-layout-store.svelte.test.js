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
  nextFolderId,
  useRailLayout,
  writeRailLayoutCache,
  setRailLayoutPublisher
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

// --- sync seam -------------------------------------------------------------
// Added with the encrypted cross-device layout (2026-08-07). The store gained
// exactly one job here: hand an arrangement to whoever is syncing, WITHOUT
// letting that concern reach the read path.

describe('the sync seam', () => {
  it('offers a user edit to the publisher', () => {
    /** @type {any[]} */
    const sent = [];
    setRailLayoutPublisher((/** @type {any} */ p, /** @type {any} */ l) => sent.push([p, l]));

    const layout = [{ type: 'item', key: 'community:x' }];
    writeRailLayout(ME, /** @type {any} */ (layout));

    expect(sent).toEqual([[ME, layout]]);
    setRailLayoutPublisher(() => {});
  });

  // The mirror path. A layout arriving FROM another device must land in the
  // local cache without being handed straight back to the publisher — that
  // would have every device republish everything it receives.
  it('does not publish a layout it merely cached', () => {
    /** @type {any[]} */
    const sent = [];
    setRailLayoutPublisher((/** @type {any} */ p) => sent.push(p));

    writeRailLayoutCache(ME, /** @type {any} */ ([{ type: 'item', key: 'community:x' }]));

    expect(sent).toEqual([]);
    expect(readRailLayout(ME)).toEqual([{ type: 'item', key: 'community:x' }]);
    setRailLayoutPublisher(() => {});
  });

  // The trap the brief names first: one save per render turns "the relay has
  // not answered yet" into "the user deleted everything". Reading is not
  // writing, at either level.
  it('neither stores nor publishes anything from being read', () => {
    /** @type {any[]} */
    const sent = [];
    setRailLayoutPublisher((/** @type {any} */ p) => sent.push(p));
    localStorage.clear();

    const getLayout = useRailLayout(
      () => ME,
      () => ['community:x', 'area:y']
    );
    for (let i = 0; i < 10; i++) getLayout();

    expect(sent).toEqual([]);
    expect(localStorage.length).toBe(0);
    setRailLayoutPublisher(() => {});
  });

  it('still stores locally when nothing is listening', () => {
    setRailLayoutPublisher(/** @type {any} */ (null));
    const layout = [{ type: 'item', key: 'community:x' }];
    expect(() => writeRailLayout(ME, /** @type {any} */ (layout))).not.toThrow();
    expect(readRailLayout(ME)).toEqual(layout);
  });
});
