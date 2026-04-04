/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { Subject } from 'rxjs';
import { CommunityPinListModel } from '$lib/models/pin-list.js';

// Helper to simulate eventStore.replaceable() returning an observable
/** @param {any} event */
function createMockEventStore(event) {
  return {
    replaceable: vi.fn(() => {
      const subject = new Subject();
      setTimeout(() => subject.next(event), 0);
      return subject.asObservable();
    })
  };
}

const communityPubkey = 'aa'.repeat(32);

describe('CommunityPinListModel', () => {
  it('returns undefined when no kind 10001 exists', async () => {
    const store = createMockEventStore(undefined);
    const model = CommunityPinListModel(communityPubkey);
    const result = await new Promise((resolve) => {
      model(store).subscribe((val) => resolve(val));
    });
    expect(result).toBeUndefined();
  });

  it('parses e tags into EventPointers', async () => {
    const event = {
      kind: 10001,
      pubkey: communityPubkey,
      tags: [
        ['e', 'abc123', 'wss://relay.example.com'],
        ['e', 'def456']
      ],
      content: '',
      created_at: 1700000000
    };
    const store = createMockEventStore(event);
    const model = CommunityPinListModel(communityPubkey);
    const result = await new Promise((resolve) => {
      model(store).subscribe((val) => resolve(val));
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'abc123' });
    expect(result[0].relays).toContain('wss://relay.example.com');
    expect(result[1]).toMatchObject({ id: 'def456' });
  });

  it('parses a tags into AddressPointers', async () => {
    const event = {
      kind: 10001,
      pubkey: communityPubkey,
      tags: [['a', `30023:${'bb'.repeat(32)}:my-article`, 'wss://relay.example.com']],
      content: '',
      created_at: 1700000000
    };
    const store = createMockEventStore(event);
    const model = CommunityPinListModel(communityPubkey);
    const result = await new Promise((resolve) => {
      model(store).subscribe((val) => resolve(val));
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 30023,
      pubkey: 'bb'.repeat(32),
      identifier: 'my-article'
    });
  });

  it('returns mixed pointers in tag order', async () => {
    const event = {
      kind: 10001,
      pubkey: communityPubkey,
      tags: [
        ['e', 'first-event'],
        ['a', `30818:${'cc'.repeat(32)}:wiki-page`],
        ['e', 'third-event']
      ],
      content: '',
      created_at: 1700000000
    };
    const store = createMockEventStore(event);
    const model = CommunityPinListModel(communityPubkey);
    const result = await new Promise((resolve) => {
      model(store).subscribe((val) => resolve(val));
    });
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveProperty('id', 'first-event');
    expect(result[1]).toHaveProperty('kind', 30818);
    expect(result[2]).toHaveProperty('id', 'third-event');
  });

  it('ignores non-e/a tags', async () => {
    const event = {
      kind: 10001,
      pubkey: communityPubkey,
      tags: [
        ['e', 'valid-event'],
        ['p', 'some-pubkey'],
        ['d', 'some-dtag']
      ],
      content: '',
      created_at: 1700000000
    };
    const store = createMockEventStore(event);
    const model = CommunityPinListModel(communityPubkey);
    const result = await new Promise((resolve) => {
      model(store).subscribe((val) => resolve(val));
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('id', 'valid-event');
  });
});
