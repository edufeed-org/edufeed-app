import { describe, it, expect } from 'vitest';
import { selectAdminApplications } from '../membership-applications.js';

const ADMIN1 = 'a'.repeat(64);
const ADMIN2 = 'c'.repeat(64);
const APPLICANT = 'b'.repeat(64);
const APPLICANT2 = 'd'.repeat(64);
const FORM_ADDRESS = `30168:${ADMIN1}:edufeed-membership`;

/**
 * @param {{ id: string, pubkey?: string, admin?: string, at?: number, form?: string }} opts
 */
function copy({ id, pubkey = APPLICANT, admin = ADMIN1, at = 1_700_000_000, form = FORM_ADDRESS }) {
  return {
    id,
    kind: 1069,
    pubkey,
    created_at: at,
    content: '<encrypted>',
    sig: '0'.repeat(128),
    tags: [['a', form], ['p', admin], ['encrypted']]
  };
}

describe('selectAdminApplications', () => {
  it('keeps only the copies addressed to this admin', () => {
    const events = [copy({ id: 'mine' }), copy({ id: 'theirs', admin: ADMIN2 })];
    expect(selectAdminApplications(events, FORM_ADDRESS, ADMIN1).map((e) => e.id)).toEqual([
      'mine'
    ]);
  });

  it('ignores responses to a different form', () => {
    const events = [copy({ id: 'other-form', form: `30168:${ADMIN1}:something-else` })];
    expect(selectAdminApplications(events, FORM_ADDRESS, ADMIN1)).toEqual([]);
  });

  it('collapses a re-submitted application to the newest copy', () => {
    // Kind 1069 is a regular event: an update adds a copy, it does not replace.
    const events = [
      copy({ id: 'updated', at: 1_700_000_500 }),
      copy({ id: 'original', at: 1_700_000_000 })
    ];
    const selected = selectAdminApplications(events, FORM_ADDRESS, ADMIN1);
    expect(selected.map((e) => e.id)).toEqual(['updated']);
  });

  it('picks the newest regardless of arrival order', () => {
    const events = [
      copy({ id: 'original', at: 1_700_000_000 }),
      copy({ id: 'updated', at: 1_700_000_500 })
    ];
    expect(selectAdminApplications(events, FORM_ADDRESS, ADMIN1).map((e) => e.id)).toEqual([
      'updated'
    ]);
  });

  it('breaks created_at ties deterministically, not by arrival order', () => {
    const a = copy({ id: 'aaa1' });
    const b = copy({ id: 'bbb2' });
    expect(selectAdminApplications([a, b], FORM_ADDRESS, ADMIN1).map((e) => e.id)).toEqual([
      'aaa1'
    ]);
    expect(selectAdminApplications([b, a], FORM_ADDRESS, ADMIN1).map((e) => e.id)).toEqual([
      'aaa1'
    ]);
  });

  it('does not collapse across applicants', () => {
    const events = [
      copy({ id: 'from-b', pubkey: APPLICANT }),
      copy({ id: 'from-d', pubkey: APPLICANT2 })
    ];
    expect(selectAdminApplications(events, FORM_ADDRESS, ADMIN1).map((e) => e.id)).toEqual([
      'from-b',
      'from-d'
    ]);
  });

  it('returns nothing without a form address or admin pubkey', () => {
    const events = [copy({ id: 'mine' })];
    expect(selectAdminApplications(events, '', ADMIN1)).toEqual([]);
    expect(selectAdminApplications(events, FORM_ADDRESS, '')).toEqual([]);
  });

  it('tolerates a missing timeline', () => {
    expect(selectAdminApplications(undefined, FORM_ADDRESS, ADMIN1)).toEqual([]);
  });
});
