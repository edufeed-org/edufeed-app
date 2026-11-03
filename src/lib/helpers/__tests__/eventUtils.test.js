/**
 * getCalendarEventMetadata — tags are untrusted network input. Only a tag's
 * value slot (`tag[1]`) belongs in the fields the UI reads from multiple tags
 * of the same name (`references`, `eventReferences`, `hashtags`). Extra
 * slots on a tag (relay hints, markers, roles — e.g. NIP-52's own
 * `["r", url, "x"]` or `["p", pubkey, relay, role]`) must never spill into
 * those arrays as if they were additional tag values.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getCalendarEventMetadata } from '../eventUtils.js';

/** @param {string[][]} tags */
const event = (tags) => ({
  id: 'e'.repeat(64),
  pubkey: 'p'.repeat(64),
  kind: 31923,
  created_at: 1_700_000_000,
  content: '',
  tags
});

describe('getCalendarEventMetadata — tag slots', () => {
  it('does not add an r tag`s extra slot (relay hint / marker) to references', () => {
    const meta = getCalendarEventMetadata(
      event([
        ['d', 'ev-1'],
        ['title', 'T'],
        ['start', '1700000000'],
        ['r', 'https://example.com', 'x']
      ])
    );
    expect(meta.references).toEqual(['https://example.com']);
  });

  it('does not add an a tag`s extra slot to eventReferences', () => {
    const meta = getCalendarEventMetadata(
      event([
        ['d', 'ev-1'],
        ['title', 'T'],
        ['start', '1700000000'],
        ['a', '31923:abc:def', 'wss://relay.example']
      ])
    );
    expect(meta.eventReferences).toEqual(['31923:abc:def']);
  });

  it('keeps one value per tag when the same name repeats', () => {
    const meta = getCalendarEventMetadata(
      event([
        ['d', 'ev-1'],
        ['title', 'T'],
        ['start', '1700000000'],
        ['t', 'music', 'extra-slot'],
        ['t', 'outdoors']
      ])
    );
    expect(meta.hashtags).toEqual(['music', 'outdoors']);
  });
});
