/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { groupsFeatureAvailable } from '$lib/groups/feature.js';

describe('groupsFeatureAvailable', () => {
  it('requires the flag AND at least one relay', () => {
    expect(groupsFeatureAvailable({ enabled: true, relays: ['wss://g.example.com'] })).toBe(true);
    expect(groupsFeatureAvailable({ enabled: true, relays: [] })).toBe(false);
    expect(groupsFeatureAvailable({ enabled: false, relays: ['wss://g.example.com'] })).toBe(false);
    expect(groupsFeatureAvailable({ enabled: undefined, relays: undefined })).toBe(false);
  });
});
