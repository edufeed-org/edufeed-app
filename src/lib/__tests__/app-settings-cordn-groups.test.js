/**
 * App Settings — cordnGroupsEnabled opt-in Tests
 *
 * Mirrors migrateSettings() behavior for the Cordn groups per-user opt-in
 * (same test pattern as app-settings-feed-source.test.js: the runes module
 * touches browser APIs at load, so the migration logic is tested directly).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

/** Mirrors migrateSettings() for the cordnGroupsEnabled flag. */
function migrateCordnGroupsEnabled(/** @type {Record<string, any>} */ stored) {
  return { cordnGroupsEnabled: stored.cordnGroupsEnabled ?? false };
}

describe('cordnGroupsEnabled migration', () => {
  it('defaults to false for users without the stored property (opt-in)', () => {
    expect(migrateCordnGroupsEnabled({}).cordnGroupsEnabled).toBe(false);
    expect(migrateCordnGroupsEnabled({ gatedMode: true }).cordnGroupsEnabled).toBe(false);
  });

  it('preserves an explicit opt-in and opt-out across loads', () => {
    expect(migrateCordnGroupsEnabled({ cordnGroupsEnabled: true }).cordnGroupsEnabled).toBe(true);
    expect(migrateCordnGroupsEnabled({ cordnGroupsEnabled: false }).cordnGroupsEnabled).toBe(false);
  });
});
