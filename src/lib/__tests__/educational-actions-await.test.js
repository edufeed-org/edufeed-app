/**
 * createResource options (Termi's describing 30142): `extraTags` appended,
 * `subjectOptional` skips the subject check, `awaitPublish` waits for a relay
 * and rejects with publish_failed when none accepted.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @type {any} */
let lastSigned = null;
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      type: 'nsec',
      pubkey: 'a'.repeat(64),
      signEvent: async (/** @type {any} */ t) => (lastSigned = { ...t, pubkey: 'a'.repeat(64) })
    }
  }
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ encodeEventToNaddr: vi.fn(() => 'naddr1res') }));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn(),
  publishEvent: vi.fn(async () => ({ success: true, acceptedRelays: ['wss://ok.relay/'] }))
}));
vi.mock('$lib/helpers/replaceableUpdates.js', () => ({
  cachePublishedEvent: vi.fn(),
  nextCreatedAt: () => 1
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => ['wss://amb.relay/'])
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPrimaryWriteRelay: vi.fn(async () => 'wss://write.relay/')
}));

const { createEducationalActions } = await import('../stores/educational-actions.svelte.js');
const { publishEvent, publishEventOptimistic } = await import('$lib/services/publish-service.js');

const LRT = 'https://w3id.org/kim/hcrt/lesson_plan';
const form = /** @type {any} */ ({
  name: 'Reihe',
  description: 'Beschreibung',
  slug: 'nostr:naddr1abc',
  learningResourceType: LRT,
  learningResourceTypes: [LRT],
  learningResourceTypeLabels: [{ id: LRT, label: 'Unterrichtsplanung' }],
  about: [],
  aboutLabels: [],
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  creators: [],
  keywords: [],
  files: []
});
const MARKER = ['a', `30040:${'a'.repeat(64)}:lesson-c1`, 'wss://amb.relay/', 'id'];

beforeEach(() => {
  vi.mocked(publishEvent).mockClear();
  vi.mocked(publishEventOptimistic).mockClear();
});

describe('createResource options', () => {
  it('without a subject only when subjectOptional', async () => {
    await expect(createEducationalActions().createResource(form)).rejects.toThrow('subject');
  });

  it('awaitPublish: waits, appends the marker, keeps the AMB id as d', async () => {
    const { naddr } = await createEducationalActions().createResource(form, 'amb', {
      extraTags: [MARKER],
      subjectOptional: true,
      awaitPublish: true
    });
    expect(naddr).toBe('naddr1res');
    expect(publishEventOptimistic).not.toHaveBeenCalled();
    expect(lastSigned.tags).toContainEqual(MARKER);
    expect(lastSigned.tags.find((/** @type {string[]} */ t) => t[0] === 'd')[1]).toBe(
      'nostr:naddr1abc'
    );
  });

  it('awaitPublish: no relay accepted → publish_failed', async () => {
    vi.mocked(publishEvent).mockResolvedValueOnce(
      /** @type {any} */ ({ success: false, acceptedRelays: [] })
    );
    await expect(
      createEducationalActions().createResource(form, 'amb', {
        subjectOptional: true,
        awaitPublish: true
      })
    ).rejects.toThrow('publish_failed');
  });
});
