/**
 * Meet content type registration tests
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  CONTENT_TYPE_CONFIG,
  CONTENT_TYPE_TO_SECTION,
  kindToContentType,
  getCommunityAvailableContentTypes
} from '$lib/helpers/contentTypes.js';

describe('Meet content type config', () => {
  it('has entry for kind 30312 (room definition)', () => {
    const config = CONTENT_TYPE_CONFIG[30312];
    expect(config).toBeDefined();
    expect(config.kind).toBe(30312);
    expect(config.name).toBe('Meet');
    expect(config.supported).toBe(true);
  });

  it('has entry for kind 30313 (room participant)', () => {
    const config = CONTENT_TYPE_CONFIG[30313];
    expect(config).toBeDefined();
    expect(config.kind).toBe(30313);
    expect(config.name).toBe('Meet');
    expect(config.supported).toBe(true);
  });
});

describe('kindToContentType for Meet', () => {
  it('maps 30312 to meet', () => {
    expect(kindToContentType(30312)).toBe('meet');
  });

  it('maps 30313 to meet', () => {
    expect(kindToContentType(30313)).toBe('meet');
  });

  it('maps 10312 to meet', () => {
    expect(kindToContentType(10312)).toBe('meet');
  });
});

describe('CONTENT_TYPE_TO_SECTION', () => {
  it('has meet entry', () => {
    expect(CONTENT_TYPE_TO_SECTION.meet).toBe('Meet');
  });
});

describe('getCommunityAvailableContentTypes meet consolidation', () => {
  it('consolidates MEET_KINDS into a single Meet tab', () => {
    const communityEvent = {
      tags: [
        ['content', 'Meet'],
        ['k', '30312'],
        ['k', '30313']
      ]
    };

    const result = getCommunityAvailableContentTypes(communityEvent);
    const meetEntries = result.filter((ct) => kindToContentType(ct.kind) === 'meet');

    // Should have exactly one consolidated Meet tab
    expect(meetEntries).toHaveLength(1);
    expect(meetEntries[0].kind).toBe(30312);
    expect(meetEntries[0].name).toBe('Meet');
    expect(meetEntries[0].enabled).toBe(true);
  });

  it('does not show Meet tab when community has no meet kinds', () => {
    const communityEvent = {
      tags: [
        ['content', 'Chat'],
        ['k', '9']
      ]
    };

    const result = getCommunityAvailableContentTypes(communityEvent);
    const meetEntries = result.filter((ct) => kindToContentType(ct.kind) === 'meet');
    expect(meetEntries).toHaveLength(0);
  });
});
