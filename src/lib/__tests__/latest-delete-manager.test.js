/** @vitest-environment node */
// applesauce-core 7.0.3's DeleteManager keeps the LAST added deletion time per
// address, not the newest: an older kind 5 arriving after a newer one pulls the
// "deleted until" back, and a copy published between the two re-enters the
// store as live (a deleted relay list kept reading as present, issue 22bf9b1e).
import { describe, it, expect } from 'vitest';
import { LatestDeleteManager } from '$lib/helpers/latest-delete-manager.js';

const PK = 'a'.repeat(64);
/** @param {number} created_at */
const deletion = (created_at) => ({
  id: `del-${created_at}`,
  kind: 5,
  pubkey: PK,
  created_at,
  tags: [['a', `10002:${PK}:`]],
  content: '',
  sig: ''
});
const relayList = {
  id: 'list',
  kind: 10002,
  pubkey: PK,
  created_at: 200,
  tags: [],
  content: '',
  sig: ''
};

describe('LatestDeleteManager', () => {
  it('keeps the newest deletion time when an older deletion arrives later', () => {
    const dm = new LatestDeleteManager();
    dm.add(deletion(300));
    dm.add(deletion(100));
    expect(dm.check(relayList)).toBe(true);
  });

  it('still lets a version newer than every deletion through', () => {
    const dm = new LatestDeleteManager();
    dm.add(deletion(100));
    expect(dm.check(relayList)).toBe(false);
  });
});
