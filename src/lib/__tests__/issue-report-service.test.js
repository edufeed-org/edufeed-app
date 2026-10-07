// @ts-nocheck
/**
 * submitIssueReport — signs the kind 1621 template with the active account and
 * publishes it to the repo announcement relays via the outbox model.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  signEvent: vi.fn()
}));

vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: ({ signer }) => ({
    build: async (template) => ({ created_at: 1700000000, ...template, tags: [...template.tags] }),
    sign: async (draft) => signer.signEvent(draft)
  })
}));

import { submitIssueReport } from '$lib/services/issue-report.js';
import { ISSUE_REPORT_REPO } from '$lib/helpers/issue-report.js';

const PUBKEY = 'ef'.repeat(32);
const activeUser = { pubkey: PUBKEY, signer: { signEvent: mocks.signEvent } };
const report = {
  subject: 'Broken page',
  description: 'It crashed',
  type: /** @type {const} */ ('bug'),
  context: { route: '/x', userAgent: 'ua', version: '0.3.4', errorMessage: '', errorStack: '' }
};

beforeEach(() => {
  mocks.publishEvent.mockReset();
  mocks.signEvent.mockReset();
  mocks.signEvent.mockImplementation(async (draft) => ({
    ...draft,
    id: 'ab'.repeat(32),
    pubkey: PUBKEY,
    sig: 'sig'
  }));
});

describe('submitIssueReport', () => {
  it('signs a kind 1621 and publishes it to the repo relays, p-tagging maintainers', async () => {
    mocks.publishEvent.mockResolvedValue({
      success: true,
      relays: ['wss://relay.ngit.dev', 'wss://gitnostr.com'],
      successCount: 1,
      results: [
        { relay: 'wss://relay.ngit.dev', success: true },
        { relay: 'wss://gitnostr.com', success: false }
      ]
    });

    const out = await submitIssueReport(report, activeUser);

    expect(mocks.signEvent).toHaveBeenCalledTimes(1);
    const signedDraft = mocks.signEvent.mock.calls[0][0];
    expect(signedDraft.kind).toBe(1621);
    expect(signedDraft.tags).toContainEqual(['subject', 'Broken page']);

    expect(mocks.publishEvent).toHaveBeenCalledTimes(1);
    const [signed, taggedPubkeys, opts] = mocks.publishEvent.mock.calls[0];
    expect(signed.id).toBe('ab'.repeat(32));
    expect(taggedPubkeys).toEqual([...ISSUE_REPORT_REPO.maintainers]);
    expect(opts.additionalRelays).toEqual([...ISSUE_REPORT_REPO.relays]);

    expect(out.event.id).toBe('ab'.repeat(32));
    expect(out.url).toMatch(/^https:\/\/gitworkshop\.dev\/nevent1/);
    expect(out.relays).toEqual(['wss://relay.ngit.dev']);
  });

  it('refuses without a signer and never publishes', async () => {
    await expect(submitIssueReport(report, null)).rejects.toThrow(/sign in/i);
    await expect(submitIssueReport(report, { pubkey: PUBKEY })).rejects.toThrow(/sign in/i);
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('surfaces a signer refusal (read-only account) without publishing', async () => {
    mocks.signEvent.mockRejectedValue(new Error('read-only'));
    await expect(submitIssueReport(report, activeUser)).rejects.toThrow('read-only');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('fails when no relay accepted the issue', async () => {
    mocks.publishEvent.mockResolvedValue({
      success: false,
      relays: [],
      successCount: 0,
      results: []
    });
    await expect(submitIssueReport(report, activeUser)).rejects.toThrow(/no relay/i);
  });
});
