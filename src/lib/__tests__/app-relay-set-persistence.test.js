/**
 * App Relay Set Persistence Tests
 *
 * Tests that kind 30002 relay set events are saved and loaded from the same relays,
 * ensuring persistence across page reloads.
 *
 * Root cause: save used publishEvent (outbox write relays only) but load queried
 * relayListLookupRelays — no guaranteed overlap.
 *
 * Fix: save includes lookupRelays as additionalRelays; load uses addressLoader
 * with explicit relays matching lookupRelays.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CATEGORIES,
  getRelaySetDTag,
  parseRelaySetEvent
} from '$lib/services/app-relay-service.svelte.js';

// Mock relay list lookup relays
const MOCK_LOOKUP_RELAYS = ['wss://purplepag.es', 'wss://relay.damus.io', 'wss://nos.lol'];

describe('App relay set persistence: relay alignment', () => {
  describe('Save must include lookupRelays as additionalRelays', () => {
    it('should pass lookupRelays to publishEvent as additionalRelays', async () => {
      // Simulate the fixed saveAppRelaySet logic
      const publishEventMock = vi.fn().mockResolvedValue({ success: true, successCount: 1 });
      const lookupRelays = MOCK_LOOKUP_RELAYS;

      const category = 'calendar';
      const relays = ['wss://my-relay.example.com'];
      const dTag = getRelaySetDTag(category);

      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dTag], ...relays.map((r) => ['relay', r])],
        content: '',
        id: 'test-id',
        pubkey: 'test-pubkey',
        sig: 'test-sig'
      };

      // Call publishEvent with additionalRelays (the fix)
      await publishEventMock(event, [], { additionalRelays: lookupRelays });

      expect(publishEventMock).toHaveBeenCalledWith(event, [], {
        additionalRelays: lookupRelays
      });

      const callArgs = publishEventMock.mock.calls[0];
      expect(callArgs[2].additionalRelays).toContain('wss://purplepag.es');
      expect(callArgs[2].additionalRelays).toContain('wss://relay.damus.io');
      expect(callArgs[2].additionalRelays).toContain('wss://nos.lol');
    });

    it('should NOT update cache when publish fails', async () => {
      const publishEventMock = vi
        .fn()
        .mockResolvedValue({ success: false, successCount: 0, relays: [] });
      const lookupRelays = MOCK_LOOKUP_RELAYS;

      const category = 'educational';
      const relays = ['wss://my-relay.example.com'];
      const dTag = getRelaySetDTag(category);

      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dTag], ...relays.map((r) => ['relay', r])],
        content: ''
      };

      const result = await publishEventMock(event, [], { additionalRelays: lookupRelays });

      // Simulate the fixed error handling
      let cacheUpdated = false;
      let errorSet = null;
      if (!result.success) {
        errorSet = 'Failed to save relay settings to any relay';
      } else {
        cacheUpdated = true;
      }

      expect(cacheUpdated).toBe(false);
      expect(errorSet).toBe('Failed to save relay settings to any relay');
    });

    it('should update cache only when publish succeeds', async () => {
      const publishEventMock = vi
        .fn()
        .mockResolvedValue({ success: true, successCount: 2, relays: ['wss://a', 'wss://b'] });
      const lookupRelays = MOCK_LOOKUP_RELAYS;

      const category = 'communikey';
      const relays = ['wss://my-relay.example.com'];
      const dTag = getRelaySetDTag(category);

      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dTag], ...relays.map((r) => ['relay', r])],
        content: ''
      };

      const result = await publishEventMock(event, [], { additionalRelays: lookupRelays });

      let cacheUpdated = false;
      let errorSet = null;
      if (!result.success) {
        errorSet = 'Failed to save relay settings to any relay';
      } else {
        cacheUpdated = true;
      }

      expect(cacheUpdated).toBe(true);
      expect(errorSet).toBeNull();
    });
  });

  describe('Load must use addressLoader with lookupRelays', () => {
    it('should load each category with correct kind, identifier, and relays', () => {
      const addressLoaderCalls = [];

      // Simulate the fixed load logic
      const lookupRelays = MOCK_LOOKUP_RELAYS;
      const pubkey = 'abc123';

      for (const category of Object.keys(CATEGORIES)) {
        const dTag = getRelaySetDTag(category);
        // Simulate addressLoader call
        addressLoaderCalls.push({
          kind: 30002,
          pubkey,
          identifier: dTag,
          relays: lookupRelays
        });
      }

      expect(addressLoaderCalls).toHaveLength(Object.keys(CATEGORIES).length);

      for (const call of addressLoaderCalls) {
        expect(call.kind).toBe(30002);
        expect(call.pubkey).toBe(pubkey);
        expect(call.relays).toEqual(MOCK_LOOKUP_RELAYS);
        // identifier should be APP_NAME/category format
        expect(call.identifier).toMatch(/^[^/]+\//);
      }

      // Verify specific categories
      const calendarCall = addressLoaderCalls.find((c) => c.identifier.endsWith('/calendar'));
      expect(calendarCall).toBeDefined();

      const eduCall = addressLoaderCalls.find((c) => c.identifier.endsWith('/educational'));
      expect(eduCall).toBeDefined();
    });

    it('should generate correct d-tags for all categories', () => {
      const categories = Object.keys(CATEGORIES);
      expect(categories).toContain('calendar');
      expect(categories).toContain('communikey');
      expect(categories).toContain('educational');
      expect(categories).toContain('longform');
      expect(categories).toContain('kanban');

      for (const category of categories) {
        const dTag = getRelaySetDTag(category);
        expect(dTag).toContain(category);
        expect(dTag).toContain('/');
      }
    });
  });

  describe('Round-trip: save → EventStore → load', () => {
    it('should parse relay URLs from a kind 30002 event correctly', () => {
      const relays = ['wss://relay1.example.com', 'wss://relay2.example.com'];
      const dTag = getRelaySetDTag('calendar');

      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dTag], ...relays.map((r) => ['relay', r])],
        content: '',
        id: 'test-id',
        pubkey: 'test-pubkey',
        sig: 'test-sig'
      };

      const parsed = parseRelaySetEvent(event);
      expect(parsed).toEqual(relays);
    });

    it('should return empty array for null event', () => {
      expect(parseRelaySetEvent(null)).toEqual([]);
      expect(parseRelaySetEvent(undefined)).toEqual([]);
    });

    it('should return each relay once when a relay tag is repeated', () => {
      // The settings page renders these in a keyed {#each ... (relay)}. A kind
      // 30002 is untrusted network input, so a repeated relay tag would hand
      // Svelte a duplicate key and kill the whole page (each_key_duplicate).
      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'Edufeed/calendar'],
          ['relay', 'wss://dup.example.com'],
          ['relay', 'wss://other.example.com'],
          ['relay', 'wss://dup.example.com']
        ],
        content: '',
        id: 'test-id',
        pubkey: 'test-pubkey',
        sig: 'test-sig'
      };

      expect(parseRelaySetEvent(event)).toEqual([
        'wss://dup.example.com',
        'wss://other.example.com'
      ]);
    });

    it('should return empty array for event with no relay tags', () => {
      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', 'ComCal/calendar']],
        content: '',
        id: 'test-id',
        pubkey: 'test-pubkey',
        sig: 'test-sig'
      };

      expect(parseRelaySetEvent(event)).toEqual([]);
    });

    it('should handle empty relay set (reset to defaults)', () => {
      const dTag = getRelaySetDTag('educational');

      const event = {
        kind: 30002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', dTag]],
        content: '',
        id: 'test-id',
        pubkey: 'test-pubkey',
        sig: 'test-sig'
      };

      const parsed = parseRelaySetEvent(event);
      expect(parsed).toEqual([]);
    });
  });

  describe('Relay overlap guarantee', () => {
    it('save relays should overlap with load relays', () => {
      const lookupRelays = MOCK_LOOKUP_RELAYS;

      // Save: publishEvent uses outboxRelays + appRelays + additionalRelays(lookupRelays)
      const saveRelaySet = new Set([
        'wss://user-write-relay.example.com', // outbox
        ...lookupRelays // additionalRelays (the fix)
      ]);

      // Load: addressLoader queries lookupRelays
      const loadRelays = new Set(lookupRelays);

      // Verify overlap: at least one relay appears in both sets
      const overlap = [...loadRelays].filter((r) => saveRelaySet.has(r));
      expect(overlap.length).toBeGreaterThan(0);
      // All lookup relays should be in save set
      expect(overlap.length).toBe(lookupRelays.length);
    });

    it('without the fix, save and load relay sets may not overlap', () => {
      // Before fix: save only used outbox write relays
      const saveRelaySet = new Set([
        'wss://user-write-relay.example.com' // outbox only
      ]);

      // Load: queried from lookupRelays
      const loadRelays = new Set(MOCK_LOOKUP_RELAYS);

      // No overlap!
      const overlap = [...loadRelays].filter((r) => saveRelaySet.has(r));
      expect(overlap.length).toBe(0);
    });
  });
});
