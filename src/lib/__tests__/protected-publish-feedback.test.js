// @ts-nocheck
/**
 * A protected event lands on fewer relays than a normal one (only those that
 * AUTH and enforce NIP-70), so the author is told where it ended up.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const showToast = vi.fn();
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (...a) => showToast(...a) }));
vi.mock('$lib/paraglide/messages', () => ({
  protected_publish_accepted: ({ relays }) => `accepted: ${relays}`,
  protected_publish_failed: () => 'failed',
  protected_publish_no_relays: () => 'no relays'
}));

import {
  announceProtectedPublish,
  relayHostList
} from '$lib/helpers/protected-publish-feedback.js';

beforeEach(() => showToast.mockClear());

describe('relayHostList', () => {
  it('shows host names, deduped, in order', () => {
    expect(
      relayHostList([
        'wss://relay.edufeed.org/',
        'wss://amb-relay.edufeed.org',
        'wss://relay.edufeed.org'
      ])
    ).toBe('relay.edufeed.org, amb-relay.edufeed.org');
  });

  it('keeps a value that is not a URL as is', () => {
    expect(relayHostList(['not a url'])).toBe('not a url');
  });
});

describe('announceProtectedPublish', () => {
  it('stays quiet until every relay has answered', () => {
    announceProtectedPublish({ status: 'success', acceptedRelays: ['wss://a/'] });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('names the accepting relays once done', () => {
    announceProtectedPublish({
      status: 'success',
      done: true,
      acceptedRelays: ['wss://relay.edufeed.org/']
    });
    expect(showToast).toHaveBeenCalledWith(
      'accepted: relay.edufeed.org',
      'success',
      expect.any(Number)
    );
  });

  it('says plainly when no relay could take it', () => {
    announceProtectedPublish({ status: 'failed', done: true, acceptedRelays: [], totalRelays: 0 });
    expect(showToast).toHaveBeenCalledWith('no relays', 'error', expect.any(Number));
  });

  it('reports a refusal by every relay', () => {
    announceProtectedPublish({ status: 'failed', done: true, acceptedRelays: [], totalRelays: 2 });
    expect(showToast).toHaveBeenCalledWith('failed', 'error', expect.any(Number));
  });
});
