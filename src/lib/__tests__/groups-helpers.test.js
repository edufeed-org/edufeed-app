/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseGroupInput,
  isValidRelayUrl,
  isValidRelayWebsocketUrl,
  buildGroupMessageTemplate,
  buildJoinRequestTemplate,
  buildLeaveRequestTemplate,
  buildGroupsListTemplate,
  groupHref,
  isAlreadyMemberError
} from '$lib/groups/groups.js';

const ME = 'c'.repeat(64);

describe('parseGroupInput', () => {
  it("parses host'id into a normalized pointer", () => {
    expect(parseGroupInput("groups.example.com'beechat")).toEqual({
      relay: 'wss://groups.example.com/',
      id: 'beechat'
    });
  });

  it('accepts an explicit wss:// prefix and trims whitespace', () => {
    expect(parseGroupInput("  wss://groups.example.com'beechat ")).toEqual({
      relay: 'wss://groups.example.com/',
      id: 'beechat'
    });
  });

  it("defaults a missing id to '_' (NIP-29 root group) and rejects empty input", () => {
    expect(parseGroupInput('groups.example.com')).toEqual({
      relay: 'wss://groups.example.com/',
      id: '_'
    });
    expect(parseGroupInput('')).toBeNull();
    expect(parseGroupInput('   ')).toBeNull();
  });

  it('rejects garbage input in BOTH URL-parser dialects', () => {
    // In Node `new URL('wss://not a pointer')` throws; Chrome instead
    // percent-encodes the space into the host and parses "fine" (TestOER,
    // 2026-08-04, measured on :5180). This case is green here in node-env
    // regardless — the cross-dialect guarantee is the isValidRelayUrl block
    // below, which tests the exact string Chrome produces.
    expect(parseGroupInput('not a pointer')).toBeNull();
  });
});

describe('isValidRelayUrl', () => {
  it('rejects the exact relay string Chrome fabricates from garbage', () => {
    // Verbatim Chrome output for parseGroupInput("not a pointer"): the
    // lenient parser percent-encodes forbidden host bytes instead of
    // throwing, so URL-parse success proves nothing in a browser.
    expect(isValidRelayUrl('wss://not%20a%20pointer/')).toBe(false);
  });

  it('accepts real relay shapes', () => {
    expect(isValidRelayUrl('wss://groups.example.com/')).toBe(true);
    expect(isValidRelayUrl('wss://relay.groups.nip29.com')).toBe(true);
    expect(isValidRelayUrl('ws://localhost:10547')).toBe(true);
    expect(isValidRelayUrl('wss://[::1]:7777')).toBe(true);
  });

  it('rejects non-hostname shapes a lenient parser lets through', () => {
    expect(isValidRelayUrl('wss://a..b/')).toBe(false);
    expect(isValidRelayUrl('wss://-leading.example.com/')).toBe(false);
    expect(isValidRelayUrl('not-a-url')).toBe(false);
    expect(isValidRelayUrl('')).toBe(false);
  });
});

describe('isValidRelayWebsocketUrl', () => {
  it('accepts ws:// and wss:// relay shapes', () => {
    expect(isValidRelayWebsocketUrl('wss://groups.example.com/')).toBe(true);
    expect(isValidRelayWebsocketUrl('ws://localhost:10547')).toBe(true);
  });

  it('rejects a scheme other than ws/wss even when the host is valid (I3)', () => {
    // The create-group relay field must not accept https:// — the group
    // would already exist on the relay by the time a ws connection fails.
    expect(isValidRelayWebsocketUrl('https://groups.example/')).toBe(false);
    expect(isValidRelayWebsocketUrl('http://groups.example/')).toBe(false);
  });

  it('still rejects everything isValidRelayUrl rejects', () => {
    expect(isValidRelayWebsocketUrl('wss://not%20a%20pointer/')).toBe(false);
    expect(isValidRelayWebsocketUrl('not-a-url')).toBe(false);
    expect(isValidRelayWebsocketUrl('')).toBe(false);
  });
});

describe('groupHref', () => {
  /** @param {{relay: string, id: string}} pointer */
  function roundTrip(pointer) {
    const href = groupHref(pointer);
    expect(href.startsWith('/groups/')).toBe(true);
    return parseGroupInput(decodeURIComponent(href.slice('/groups/'.length)));
  }

  it('round-trips a pointer through the URL param', () => {
    const pointer = { relay: 'wss://groups.example.com/', id: 'beechat' };
    expect(roundTrip(pointer)).toEqual(pointer);
  });

  // applesauce's encodeGroupPointer emits only the HOSTNAME, so a port and a
  // ws: scheme are dropped: the link then addresses a DIFFERENT relay, and it
  // fails by connecting to nothing rather than by erroring. Found in Chrome
  // against a relay on a non-default port — every unit test was green.
  it('keeps a non-default port', () => {
    const pointer = { relay: 'wss://groups.example.com:8443/', id: 'beechat' };
    expect(roundTrip(pointer)).toEqual(pointer);
  });

  it('keeps an insecure scheme (local relays)', () => {
    const pointer = { relay: 'ws://127.0.0.1:17020/', id: 'allgemein' };
    expect(roundTrip(pointer)).toEqual(pointer);
  });

  // The short `host'id` form is what people paste and read, so it must stay
  // the shape for the ordinary case.
  it('still uses the short host’id form when nothing would be lost', () => {
    const href = groupHref({ relay: 'wss://groups.example.com/', id: 'beechat' });
    expect(decodeURIComponent(href.slice('/groups/'.length))).toBe("groups.example.com'beechat");
  });
});

describe('buildGroupMessageTemplate', () => {
  it('builds a kind-9 with the h tag first, like the app community chat', () => {
    const template = buildGroupMessageTemplate('beechat', 'hello group');
    expect(template.kind).toBe(9);
    expect(template.content).toBe('hello group');
    expect(template.tags[0]).toEqual(['h', 'beechat']);
    expect(typeof template.created_at).toBe('number');
  });

  it('adds NIP-10 reply marker + p tag when replying', () => {
    const template = buildGroupMessageTemplate('beechat', 'reply text', {
      id: 'parent-1',
      pubkey: 'a'.repeat(64)
    });
    expect(template.tags).toContainEqual(['e', 'parent-1', '', 'reply']);
    expect(template.tags).toContainEqual(['p', 'a'.repeat(64)]);
  });

  // Replying to a message that is ITSELF a reply. Before root resolution the
  // template pointed its lone `reply` tag at the clicked message, which made
  // every reply-to-a-reply the root of a brand-new thread — invisible inside
  // the thread it was written in. These two cases are the only ones that can
  // tell the fixed code from the old code; the case above cannot, because
  // there the parent already IS the root.
  it('inherits the thread root when replying to a reply', () => {
    const template = buildGroupMessageTemplate('beechat', 'nested', {
      id: 'parent-1',
      pubkey: 'a'.repeat(64),
      tags: [
        ['h', 'beechat'],
        ['e', 'thread-root', '', 'reply']
      ]
    });
    expect(template.tags).toContainEqual(['e', 'thread-root', '', 'root']);
    expect(template.tags).toContainEqual(['e', 'parent-1', '', 'reply']);
    expect(template.tags).not.toContainEqual(['e', 'parent-1', '', 'root']);
  });

  it('inherits the root of an already-nested parent rather than re-rooting at depth 3', () => {
    const template = buildGroupMessageTemplate('beechat', 'deeper', {
      id: 'parent-2',
      pubkey: 'a'.repeat(64),
      tags: [
        ['e', 'thread-root', '', 'root'],
        ['e', 'parent-1', '', 'reply']
      ]
    });
    expect(template.tags).toContainEqual(['e', 'thread-root', '', 'root']);
    expect(template.tags).toContainEqual(['e', 'parent-2', '', 'reply']);
    expect(template.tags.filter((t) => t[0] === 'e')).toHaveLength(2);
  });

  // File attachments ride as NIP-92 imeta tags, the shape Armada reads and
  // writes for NIP-29 chat uploads, so the two clients render each other's
  // attachments.
  describe('attachments', () => {
    const att = {
      url: 'https://blossom.example/abc.pdf',
      type: 'application/pdf',
      sha256: 'f'.repeat(64),
      size: 1234,
      name: 'worksheet.pdf'
    };

    it('adds an imeta tag for an attachment whose URL is in the content', () => {
      const template = buildGroupMessageTemplate(
        'beechat',
        'here you go https://blossom.example/abc.pdf',
        null,
        [att]
      );
      expect(template.tags).toContainEqual([
        'imeta',
        'url https://blossom.example/abc.pdf',
        'm application/pdf',
        `x ${'f'.repeat(64)}`,
        'size 1234',
        'name worksheet.pdf'
      ]);
    });

    it('skips an attachment whose URL was edited out of the content', () => {
      const template = buildGroupMessageTemplate('beechat', 'changed my mind', null, [att]);
      expect(template.tags.some((t) => t[0] === 'imeta')).toBe(false);
    });

    it('omits imeta fields the upload could not provide', () => {
      const template = buildGroupMessageTemplate('beechat', 'https://blossom.example/xyz', null, [
        { url: 'https://blossom.example/xyz', type: 'application/octet-stream' }
      ]);
      expect(template.tags).toContainEqual([
        'imeta',
        'url https://blossom.example/xyz',
        'm application/octet-stream'
      ]);
    });
  });
});

describe('join/leave request templates', () => {
  it('kind 9021 join with h tag; invite code rides as a code tag when given', () => {
    expect(buildJoinRequestTemplate('beechat').tags).toEqual([['h', 'beechat']]);
    expect(buildJoinRequestTemplate('beechat', 'sekrit').tags).toEqual([
      ['h', 'beechat'],
      ['code', 'sekrit']
    ]);
    expect(buildJoinRequestTemplate('beechat').kind).toBe(9021);
  });

  it('kind 9022 leave with h tag', () => {
    const template = buildLeaveRequestTemplate('beechat');
    expect(template.kind).toBe(9022);
    expect(template.tags).toEqual([['h', 'beechat']]);
  });
});

describe('buildGroupsListTemplate', () => {
  const pointer = { relay: 'wss://groups.example.com/', id: 'beechat' };

  // The `r` server tag rides along with every add: Armada's rail (and
  // Flotilla's) is built from `r` tags ONLY — a `group` entry without its
  // host's `r` tag is invisible there (laoc, 2026-08-19: joined channels
  // never appeared in Armada).
  it('adds a group tag AND the host r tag to an empty list (kind 10009)', () => {
    const template = buildGroupsListTemplate(null, { add: pointer });
    expect(template.kind).toBe(10009);
    expect(template.tags).toContainEqual(['group', 'beechat', 'wss://groups.example.com/']);
    expect(template.tags).toContainEqual(['r', 'wss://groups.example.com/']);
  });

  it('does not duplicate an r tag the list already carries, across spellings', () => {
    const existing = {
      kind: 10009,
      pubkey: ME,
      content: '',
      created_at: 1,
      tags: [['r', 'wss://groups.example.com']]
    };
    const template = buildGroupsListTemplate(existing, { add: pointer });
    expect(template.tags.filter((t) => t[0] === 'r')).toHaveLength(1);
  });

  it('keeps the r tag when a group is removed — the server stays added', () => {
    const existing = {
      kind: 10009,
      pubkey: ME,
      content: '',
      created_at: 1,
      tags: [
        ['r', 'wss://groups.example.com/'],
        ['group', 'beechat', 'wss://groups.example.com/']
      ]
    };
    const removed = buildGroupsListTemplate(existing, { remove: pointer });
    expect(removed.tags).toContainEqual(['r', 'wss://groups.example.com/']);
    expect(removed.tags.some((t) => t[0] === 'group')).toBe(false);
  });

  it('preserves existing group tags, dedupes on re-add, and removes on remove', () => {
    const existing = {
      kind: 10009,
      pubkey: ME,
      content: '',
      created_at: 1,
      tags: [
        ['group', 'other', 'wss://other.example/'],
        ['group', 'beechat', 'wss://groups.example.com/']
      ]
    };
    const readd = buildGroupsListTemplate(existing, { add: pointer });
    expect(readd.tags.filter((t) => t[1] === 'beechat')).toHaveLength(1);
    // other + beechat group tags, plus the add's r server tag
    expect(readd.tags).toHaveLength(3);
    expect(readd.tags).toContainEqual(['r', 'wss://groups.example.com/']);

    const removed = buildGroupsListTemplate(existing, { remove: pointer });
    expect(removed.tags).toEqual([['group', 'other', 'wss://other.example/']]);
  });

  it('dedupes across trailing-slash spellings and serializes normalized relays', () => {
    // A list written by another client can carry "wss://host" while our join
    // flow uses "wss://host/". Adding must replace, not append a twin — and
    // rewriting the list is the moment to heal the spelling.
    const existing = {
      kind: 10009,
      pubkey: ME,
      content: '',
      created_at: 1,
      tags: [['group', 'beechat', 'wss://groups.example.com']]
    };
    const readd = buildGroupsListTemplate(existing, { add: pointer });
    expect(readd.tags).toEqual([
      ['r', 'wss://groups.example.com/'],
      ['group', 'beechat', 'wss://groups.example.com/']
    ]);

    const removed = buildGroupsListTemplate(existing, {
      remove: { id: 'beechat', relay: 'wss://groups.example.com/' }
    });
    expect(removed.tags).toEqual([]);
  });

  it('preserves non-group tags (e.g. hidden-list content stays untouched)', () => {
    const existing = {
      kind: 10009,
      pubkey: ME,
      content: 'encrypted-hidden-groups',
      created_at: 1,
      tags: [['client', 'edufeed']]
    };
    const template = buildGroupsListTemplate(existing, { add: pointer });
    expect(template.content).toBe('encrypted-hidden-groups');
    expect(template.tags).toContainEqual(['client', 'edufeed']);
  });
});

describe('isAlreadyMemberError', () => {
  // pyramid answers a redundant join with TWO different wordings depending on
  // the path: a member's own 9021 gets "duplicate: already a member"
  // (reject-event.go:108), an admin's redundant 9000 put-user gets
  // "blocked: all targets are members already" (reject-event.go:297). The
  // approve flow tolerates both — missing the second aborted a channel-knock
  // approval for anyone already seated in the root (laoc, 2026-08-21).
  it('matches the self-join duplicate wording', () => {
    expect(isAlreadyMemberError(new Error('duplicate: already a member'))).toBe(true);
  });
  it('matches the redundant put-user wording', () => {
    expect(isAlreadyMemberError(new Error('blocked: all targets are members already'))).toBe(true);
  });
  it('does not swallow real failures', () => {
    expect(isAlreadyMemberError(new Error('restricted: not an admin'))).toBe(false);
    expect(isAlreadyMemberError(undefined)).toBe(false);
  });
});
