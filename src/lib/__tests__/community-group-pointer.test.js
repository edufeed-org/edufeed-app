/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseGroupPointers,
  buildGroupPointerTag,
  withGroupPointer,
  withoutGroupPointer
} from '$lib/groups/community-pointer.js';

const R = 'wss://groups.example';
const R2 = 'wss://other.example';

/** @param {string[][]} tags */
const evt = (tags) => ({ kind: 10222, tags });

describe('parseGroupPointers', () => {
  it('returns an empty list for missing, malformed or pointer-free events', () => {
    // Deliberately off-type: these are the shapes an untrusted event can
    // actually arrive in. Cast at the fixture rather than widening the
    // production signature to accept them.
    const malformed = /** @type {any[]} */ ([
      null,
      undefined,
      {},
      { tags: null },
      { tags: 'nope' }
    ]);
    for (const bad of malformed) {
      expect(parseGroupPointers(bad)).toEqual([]);
    }
    expect(parseGroupPointers(evt([['concord', 'a'.repeat(64)]]))).toEqual([]);
  });

  // A pointer-shaped tag under a different name is NOT a channel. The concord
  // tag alone cannot prove this: it has no relay, so it would be dropped by the
  // relay rule even if the tag-name filter were gone.
  it('ignores pointer-shaped tags that are not "group" tags', () => {
    expect(parseGroupPointers(evt([['relay', 'allgemein', R]]))).toEqual([]);
    expect(parseGroupPointers(evt([['concord', 'allgemein', R]]))).toEqual([]);
  });

  it('parses every group tag, in tag order', () => {
    const out = parseGroupPointers(
      evt([
        ['group', 'allgemein', R],
        ['d', 'ignored'],
        ['group', 'leitung', R]
      ])
    );
    expect(out.map((p) => p.id)).toEqual(['allgemein', 'leitung']);
    expect(out.every((p) => p.relay === R)).toBe(true);
  });

  it('keeps the optional name from the 4th element', () => {
    const [p] = parseGroupPointers(evt([['group', 'leitung', R, 'Leitungsrunde']]));
    expect(p.name).toBe('Leitungsrunde');
  });

  // 5th element: the community's intent for a PRIVATE channel — "everyone in
  // here" vs "only the invited". The relay cannot express that split (both are
  // a private group with a member list), so it lives in our own event.
  it('keeps the access marker from the 5th element', () => {
    const [p] = parseGroupPointers(evt([['group', 'allgemein', R, 'Allgemein', 'members']]));
    expect(p.access).toBe('members');
  });

  it('accepts an access marker without a name', () => {
    const [p] = parseGroupPointers(evt([['group', 'allgemein', R, '', 'members']]));
    expect(p.access).toBe('members');
    expect(p.name).toBeUndefined();
  });

  it('drops an unrecognised access marker rather than passing it on', () => {
    const [p] = parseGroupPointers(evt([['group', 'allgemein', R, '', 'sometimes']]));
    expect(p.access).toBeUndefined();
  });

  // Tag values are untrusted network input — same rule the concord pointer applies.
  it('drops pointers whose relay is not a well-formed relay URL', () => {
    const out = parseGroupPointers(
      evt([
        ['group', 'ok', R],
        ['group', 'no-relay'],
        ['group', 'bad-relay', 'not a url'],
        ['group', 'space-in-host', 'wss://ex ample.org'],
        // These two are the only cases that actually reach the DNS-shape rule
        // under Node: a percent-encoded host makes `new URL` throw here (it
        // does NOT in Chrome), so such a string is rejected by the try/catch
        // and proves nothing about the host regex. A host that parses but is
        // not DNS-shaped does.
        ['group', 'empty-label', 'wss://a..b/'],
        ['group', 'leading-hyphen', 'wss://-leading.example.com/'],
        ['group', 'http-scheme', 'http://groups.example']
      ])
    );
    expect(out.map((p) => p.id)).toEqual(['ok']);
  });

  it('drops pointers without a usable id', () => {
    const out = parseGroupPointers(
      evt([
        ['group', '', R],
        ['group', '   ', R],
        ['group', 'keep', R]
      ])
    );
    expect(out.map((p) => p.id)).toEqual(['keep']);
  });

  // Applesauce's getPublicGroups memoises onto a Symbol on the event object.
  // Community events are held in Svelte state; a cache write from inside a
  // $derived crashes the runtime (see 061c05c9). Parsing must stay read-only.
  it('does not write a cache symbol onto the event', () => {
    const event = evt([['group', 'allgemein', R]]);
    parseGroupPointers(event);
    expect(Object.getOwnPropertySymbols(event)).toEqual([]);
  });
});

describe('buildGroupPointerTag', () => {
  it('builds ["group", id, relay]', () => {
    expect(buildGroupPointerTag({ id: 'allgemein', relay: R })).toEqual(['group', 'allgemein', R]);
  });

  it('appends the name only when there is one', () => {
    expect(buildGroupPointerTag({ id: 'x', relay: R, name: 'Nm' })).toEqual([
      'group',
      'x',
      R,
      'Nm'
    ]);
    expect(buildGroupPointerTag({ id: 'x', relay: R, name: '' })).toEqual(['group', 'x', R]);
  });

  it('holds the name slot open when there is an access marker but no name', () => {
    expect(buildGroupPointerTag({ id: 'x', relay: R, access: 'members' })).toEqual([
      'group',
      'x',
      R,
      '',
      'members'
    ]);
  });

  it('writes name and access together', () => {
    expect(buildGroupPointerTag({ id: 'x', relay: R, name: 'Nm', access: 'invited' })).toEqual([
      'group',
      'x',
      R,
      'Nm',
      'invited'
    ]);
  });

  it('round-trips through the parser', () => {
    const tag = buildGroupPointerTag({ id: 'x', relay: R, name: 'Nm', access: 'members' });
    expect(parseGroupPointers({ tags: [tag] })).toEqual([
      { id: 'x', relay: R, name: 'Nm', access: 'members' }
    ]);
  });
});

describe('withGroupPointer', () => {
  it('appends a pointer and leaves every other tag untouched', () => {
    const tags = [
      ['d', 'relilab'],
      ['concord', 'a'.repeat(64)]
    ];
    const out = withGroupPointer(tags, { id: 'allgemein', relay: R });
    expect(out).toEqual([...tags, ['group', 'allgemein', R]]);
    expect(tags).toHaveLength(2); // input not mutated
  });

  it('keeps sibling channels — this is a list, not a single pointer', () => {
    let tags = withGroupPointer([], { id: 'allgemein', relay: R });
    tags = withGroupPointer(tags, { id: 'leitung', relay: R });
    expect(parseGroupPointers({ tags }).map((p) => p.id)).toEqual(['allgemein', 'leitung']);
  });

  it('replaces in place when the same channel is written again', () => {
    const tags = withGroupPointer([['group', 'allgemein', R]], {
      id: 'allgemein',
      relay: R,
      name: 'Allgemein'
    });
    expect(tags).toEqual([['group', 'allgemein', R, 'Allgemein']]);
  });

  it('treats relay URLs that normalise equal as the same channel', () => {
    const tags = withGroupPointer([['group', 'allgemein', 'wss://groups.example/']], {
      id: 'allgemein',
      relay: 'wss://Groups.Example'
    });
    expect(tags).toHaveLength(1);
  });

  it('same id on a different relay is a different channel', () => {
    const tags = withGroupPointer([['group', 'allgemein', R]], { id: 'allgemein', relay: R2 });
    expect(tags).toHaveLength(2);
  });
});

describe('withoutGroupPointer', () => {
  it('removes exactly the named channel and keeps its siblings', () => {
    const tags = [
      ['d', 'relilab'],
      ['group', 'allgemein', R],
      ['group', 'leitung', R]
    ];
    const out = withoutGroupPointer(tags, { id: 'leitung', relay: R });
    expect(out).toEqual([
      ['d', 'relilab'],
      ['group', 'allgemein', R]
    ]);
  });

  it('matches across relay URL normalisation', () => {
    const out = withoutGroupPointer([['group', 'allgemein', 'wss://groups.example/']], {
      id: 'allgemein',
      relay: 'wss://Groups.Example'
    });
    expect(out).toEqual([]);
  });

  it('is a no-op for a channel that is not there', () => {
    const tags = [['group', 'allgemein', R]];
    expect(withoutGroupPointer(tags, { id: 'leitung', relay: R })).toEqual(tags);
  });
});
