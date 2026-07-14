/**
 * Locks in the applesauce contract the profile-edit flow depends on:
 * `UpdateProfile` (applesauce-actions) internally runs
 * `ProfileFactory.modify(existingKind0).update(partial)`, which shallow-merges
 * the partial into the existing kind-0 content.
 *
 * The edit modal relies on this to:
 *  - preserve `lud16` / `display_name` / third-party keys it no longer edits
 *  - clear fields by submitting `""` (merge overwrites, never deletes)
 *  - replace the `edufeed` object wholesale (shallow merge → always submit the
 *    full object, never a partial `edufeed`)
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { ProfileFactory } from 'applesauce-core/factories';

/** @param {Record<string, unknown>} content */
function existingKind0(content) {
  return /** @type {import('applesauce-core/helpers/event').KnownEvent<0>} */ ({
    kind: 0,
    pubkey: 'a'.repeat(64),
    created_at: 1700000000,
    tags: [],
    content: JSON.stringify(content),
    id: 'f'.repeat(64),
    sig: 'f'.repeat(128)
  });
}

/**
 * @param {Record<string, unknown>} existing
 * @param {Record<string, unknown>} partial
 */
async function merge(existing, partial) {
  const draft = await ProfileFactory.modify(existingKind0(existing)).update(partial);
  expect(draft.kind).toBe(0);
  return JSON.parse(draft.content);
}

describe('UpdateProfile merge contract (ProfileFactory.modify().update())', () => {
  it('preserves lud16, display_name, nip05 and unknown third-party keys', async () => {
    const merged = await merge(
      {
        name: 'Old Name',
        display_name: 'Old Display',
        lud16: 'anna@getalby.com',
        nip05: 'anna@edufeed.org',
        somethirdparty: { keep: true }
      },
      { name: 'New Name', about: 'Neue Beschreibung' }
    );

    expect(merged.name).toBe('New Name');
    expect(merged.about).toBe('Neue Beschreibung');
    expect(merged.display_name).toBe('Old Display');
    expect(merged.lud16).toBe('anna@getalby.com');
    expect(merged.nip05).toBe('anna@edufeed.org');
    expect(merged.somethirdparty).toEqual({ keep: true });
  });

  it('clears a field when the partial submits "" (overwrite, not delete)', async () => {
    const merged = await merge({ name: 'Anna', about: 'Old about' }, { about: '' });

    expect(merged.about).toBe('');
    expect(merged.name).toBe('Anna');
  });

  it('replaces the edufeed object wholesale (shallow merge)', async () => {
    const merged = await merge(
      {
        name: 'Anna',
        edufeed: {
          interests: ['Klettern'],
          educationalLevels: [{ id: 'https://edufeed.org/ns/bildungsbereich#schule' }],
          subjects: [{ id: 'https://example.org/old' }]
        }
      },
      { edufeed: { interests: ['Podcasts'], educationalLevels: [], subjects: [] } }
    );

    expect(merged.edufeed).toEqual({
      interests: ['Podcasts'],
      educationalLevels: [],
      subjects: []
    });
    expect(merged.name).toBe('Anna');
  });
});
