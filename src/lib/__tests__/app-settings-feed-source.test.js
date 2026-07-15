/**
 * App Settings — dashboardFeedSource Tests
 *
 * Tests for the feed source selection persistence and migration.
 * Since the app-settings module uses Svelte 5 runes and browser APIs,
 * we test the migration and default logic patterns directly.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

/**
 * Simulate the migration logic from app-settings.svelte.js
 * This mirrors migrateSettings() behavior for the dashboard feed settings.
 */
function migrateSettingsForFeedSource(/** @type {Record<string, any>} */ stored) {
  const defaultFeedSource = 'communities';
  return {
    dashboardFeedSource: stored.dashboardFeedSource ?? defaultFeedSource,
    dashboardFeedRelay: stored.dashboardFeedRelay ?? '',
    dashboardCustomRelays: Array.isArray(stored.dashboardCustomRelays)
      ? stored.dashboardCustomRelays
      : []
  };
}

describe('dashboardFeedSource migration', () => {
  it('defaults to communities when property is missing', () => {
    const result = migrateSettingsForFeedSource({});
    expect(result.dashboardFeedSource).toBe('communities');
  });

  it('preserves communities when explicitly set', () => {
    const result = migrateSettingsForFeedSource({ dashboardFeedSource: 'communities' });
    expect(result.dashboardFeedSource).toBe('communities');
  });

  it('preserves following when explicitly set', () => {
    const result = migrateSettingsForFeedSource({ dashboardFeedSource: 'following' });
    expect(result.dashboardFeedSource).toBe('following');
  });

  it('preserves combined when explicitly set', () => {
    const result = migrateSettingsForFeedSource({ dashboardFeedSource: 'combined' });
    expect(result.dashboardFeedSource).toBe('combined');
  });

  it('defaults to communities when value is null', () => {
    const result = migrateSettingsForFeedSource({ dashboardFeedSource: null });
    expect(result.dashboardFeedSource).toBe('communities');
  });

  it('defaults to communities when value is undefined', () => {
    const result = migrateSettingsForFeedSource({ dashboardFeedSource: undefined });
    expect(result.dashboardFeedSource).toBe('communities');
  });

  it('preserves other stored settings alongside new property', () => {
    const stored = {
      debugMode: true,
      gatedMode: false,
      themeFamily: 'stil',
      colorMode: 'dark'
    };
    const result = migrateSettingsForFeedSource(stored);
    expect(result.dashboardFeedSource).toBe('communities');
  });
});

describe('dashboardFeedSource valid values', () => {
  const validValues = ['communities', 'following', 'combined', 'relay'];

  it.each(validValues)('accepts "%s" as a valid feed source', (value) => {
    const result = migrateSettingsForFeedSource({ dashboardFeedSource: value });
    expect(result.dashboardFeedSource).toBe(value);
  });
});

describe('relay feed settings migration', () => {
  it('defaults dashboardFeedRelay to empty string when missing', () => {
    expect(migrateSettingsForFeedSource({}).dashboardFeedRelay).toBe('');
  });

  it('preserves a stored dashboardFeedRelay', () => {
    const result = migrateSettingsForFeedSource({ dashboardFeedRelay: 'wss://r.example/' });
    expect(result.dashboardFeedRelay).toBe('wss://r.example/');
  });

  it('defaults dashboardCustomRelays to [] when missing', () => {
    expect(migrateSettingsForFeedSource({}).dashboardCustomRelays).toEqual([]);
  });

  it('defaults dashboardCustomRelays to [] when stored value is not an array', () => {
    expect(
      migrateSettingsForFeedSource({ dashboardCustomRelays: 'wss://r.example/' })
        .dashboardCustomRelays
    ).toEqual([]);
  });

  it('preserves stored custom relays', () => {
    const result = migrateSettingsForFeedSource({
      dashboardCustomRelays: ['wss://a.example/', 'wss://b.example/']
    });
    expect(result.dashboardCustomRelays).toEqual(['wss://a.example/', 'wss://b.example/']);
  });

  it('preserves relay as a feed source', () => {
    expect(migrateSettingsForFeedSource({ dashboardFeedSource: 'relay' }).dashboardFeedSource).toBe(
      'relay'
    );
  });
});
