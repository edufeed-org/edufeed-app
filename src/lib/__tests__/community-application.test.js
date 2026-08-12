/** @vitest-environment node */
// src/lib/__tests__/community-application.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const confirmGroupAdmins = vi.fn();
vi.mock('$lib/groups/group-management.js', () => ({
  confirmGroupAdmins: (/** @type {any} */ ...args) => confirmGroupAdmins(...args)
}));

const relayConnMarker = { mocked: true };
const relayFn = vi.fn((/** @type {string} */ _url) => relayConnMarker);
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: (/** @type {string} */ url) => relayFn(url) }
}));

const buildATagWithHint = vi.fn();
const buildPTagsWithHints = vi.fn();
vi.mock('$lib/services/publish-service.js', () => ({
  buildATagWithHint: (/** @type {any} */ ...args) => buildATagWithHint(...args),
  buildPTagsWithHints: (/** @type {any} */ ...args) => buildPTagsWithHints(...args)
}));

const nip44EncryptWith = vi.fn();
vi.mock('$lib/helpers/forms.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    nip44EncryptWith: (/** @type {any} */ ...args) => nip44EncryptWith(...args)
  };
});

const { isCommunityApplication, resolveReviewers, buildApplicationCopies, NoReviewersError } =
  await import('$lib/helpers/community-application.js');
const { buildResponseTags } = await import('$lib/helpers/forms.js');

const RELAY = 'wss://groups.example.com';
const GROUP_ID = 'root-group-id-16';
const FORM_ADDRESS = '30168:creator-pubkey:join-form';

/** @param {string[]} pubkeys */
const adminsEvent = (pubkeys) => ({
  kind: 39001,
  tags: pubkeys.map((pk) => ['p', pk])
});

/** @param {{membership?: [string, string]|null, application?: string[]|null}} opts */
function communityEvent({ membership = [GROUP_ID, RELAY], application = [FORM_ADDRESS] } = {}) {
  /** @type {string[][]} */
  const tags = [];
  if (membership) tags.push(['membership', ...membership]);
  if (application) tags.push(['application', ...application]);
  return { kind: 10222, tags };
}

beforeEach(() => {
  confirmGroupAdmins.mockReset();
  relayFn.mockClear();
  buildATagWithHint.mockReset();
  buildPTagsWithHints.mockReset();
  nip44EncryptWith.mockReset();
});

describe('isCommunityApplication', () => {
  it('is true when the community application pointer resolves to the given form address', () => {
    expect(isCommunityApplication(FORM_ADDRESS, communityEvent())).toBe(true);
  });

  it('is false when the application pointer points at a different form', () => {
    const event = communityEvent({ application: ['30168:other:form'] });
    expect(isCommunityApplication(FORM_ADDRESS, event)).toBe(false);
  });

  it('is false when the community has no application pointer', () => {
    const event = communityEvent({ application: null });
    expect(isCommunityApplication(FORM_ADDRESS, event)).toBe(false);
  });

  it('is false for a null/undefined community event', () => {
    expect(isCommunityApplication(FORM_ADDRESS, null)).toBe(false);
    expect(isCommunityApplication(FORM_ADDRESS, undefined)).toBe(false);
  });
});

describe('resolveReviewers', () => {
  it('returns the deduped admin pubkeys from the root group 39001', async () => {
    const pkA = 'a'.repeat(64);
    const pkB = 'b'.repeat(64);
    confirmGroupAdmins.mockResolvedValue(adminsEvent([pkA, pkB]));

    const reviewers = await resolveReviewers(communityEvent());

    expect(reviewers).toEqual([pkA, pkB]);
    expect(confirmGroupAdmins).toHaveBeenCalledWith(relayConnMarker, GROUP_ID);
    expect(relayFn).toHaveBeenCalledWith(RELAY);
  });

  it('dedupes admin pubkeys', async () => {
    const pk = 'c'.repeat(64);
    // getGroupAdmins itself collapses duplicate p-tags for the same pubkey
    // into one entry — this asserts resolveReviewers still returns one.
    confirmGroupAdmins.mockResolvedValue(adminsEvent([pk, pk]));

    const reviewers = await resolveReviewers(communityEvent());

    expect(reviewers).toEqual([pk]);
  });

  it('throws a typed no-reviewers error when the community has no membership pointer', async () => {
    const event = communityEvent({ membership: null });
    await expect(resolveReviewers(event)).rejects.toMatchObject({ code: 'no-reviewers' });
    await expect(resolveReviewers(event)).rejects.toBeInstanceOf(NoReviewersError);
    expect(confirmGroupAdmins).not.toHaveBeenCalled();
  });

  it('throws a typed no-reviewers error when the relay has no 39001 for the group', async () => {
    confirmGroupAdmins.mockResolvedValue(null);
    await expect(resolveReviewers(communityEvent())).rejects.toMatchObject({
      code: 'no-reviewers'
    });
  });

  it('throws a typed no-reviewers error when the 39001 has no admin p-tags', async () => {
    confirmGroupAdmins.mockResolvedValue(adminsEvent([]));
    await expect(resolveReviewers(communityEvent())).rejects.toMatchObject({
      code: 'no-reviewers'
    });
  });

  it('throws a typed no-reviewers error when the relay request throws/times out (fail-safe)', async () => {
    confirmGroupAdmins.mockRejectedValue(new Error('relay timeout'));
    await expect(resolveReviewers(communityEvent())).rejects.toMatchObject({
      code: 'no-reviewers'
    });
  });
});

describe('buildApplicationCopies', () => {
  const reviewers = ['r1'.padEnd(64, '1'), 'r2'.padEnd(64, '2'), 'r3'.padEnd(64, '3')];
  const values = { name: 'Ada', motivation: 'Because' };
  /** @type {any} */
  let signer;
  /** @type {any[]} */
  let signedDrafts;

  beforeEach(() => {
    signedDrafts = [];
    signer = {
      signEvent: vi.fn(async (draft) => {
        const signed = {
          ...draft,
          pubkey: 'author-pubkey',
          id: `id-${signedDrafts.length}`,
          sig: 'sig'
        };
        signedDrafts.push(signed);
        return signed;
      })
    };
    buildATagWithHint.mockResolvedValue(['a', FORM_ADDRESS, 'wss://hint-a.example.com']);
    buildPTagsWithHints.mockImplementation(async (/** @type {string[]} */ pubkeys) =>
      pubkeys.map((pk) => ['p', pk, `wss://hint-${pk.slice(0, 2)}.example.com`])
    );
    nip44EncryptWith.mockImplementation(
      async (/** @type {any} */ _signer, /** @type {string} */ reviewer) => `cipher-${reviewer}`
    );
  });

  it('produces one signed kind 1069 event per reviewer', async () => {
    const copies = await buildApplicationCopies({
      formAddress: FORM_ADDRESS,
      values,
      signer,
      reviewers
    });
    expect(copies).toHaveLength(3);
    copies.forEach((c) => expect(c.kind).toBe(1069));
  });

  it('p-tags and encrypts each copy to its own reviewer', async () => {
    const copies = await buildApplicationCopies({
      formAddress: FORM_ADDRESS,
      values,
      signer,
      reviewers
    });

    copies.forEach((copy, i) => {
      const reviewer = reviewers[i];
      expect(copy.tags).toContainEqual(['a', FORM_ADDRESS, 'wss://hint-a.example.com']);
      expect(copy.tags).toContainEqual([
        'p',
        reviewer,
        `wss://hint-${reviewer.slice(0, 2)}.example.com`
      ]);
      expect(copy.tags).toContainEqual(['encrypted']);
      expect(copy.content).toBe(`cipher-${reviewer}`);
    });
  });

  it('calls nip44EncryptWith once per reviewer with the signer, that reviewer, and the response payload', async () => {
    await buildApplicationCopies({ formAddress: FORM_ADDRESS, values, signer, reviewers });

    const expectedPlaintext = JSON.stringify(buildResponseTags(values));
    expect(nip44EncryptWith).toHaveBeenCalledTimes(3);
    reviewers.forEach((reviewer) => {
      expect(nip44EncryptWith).toHaveBeenCalledWith(signer, reviewer, expectedPlaintext);
    });
  });

  it("signs every copy before returning (all-or-nothing build, publish is the caller's job)", async () => {
    await buildApplicationCopies({ formAddress: FORM_ADDRESS, values, signer, reviewers });
    expect(signer.signEvent).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array for an empty reviewer list', async () => {
    const copies = await buildApplicationCopies({
      formAddress: FORM_ADDRESS,
      values,
      signer,
      reviewers: []
    });
    expect(copies).toEqual([]);
    expect(nip44EncryptWith).not.toHaveBeenCalled();
  });
});
