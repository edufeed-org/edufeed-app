// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const buildSpy = vi.fn(async (tmpl) => ({ ...tmpl, created_at: 111, pubkey: 'signerpub' }));
const addSpy = vi.fn();
const publishSpy = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: (e) => addSpy(e) },
  pool: {}
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (e, p, o) => publishSpy(e, p, o)
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: (tmpl) => buildSpy(tmpl) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [] }));

const { publishLicenseAttestation } = await import('$lib/helpers/image-license.js');

const input = {
  hash: 'h1',
  url: 'https://img.example/x.jpg',
  mime: 'image/jpeg',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  credit: 'Jane'
};

describe('publishLicenseAttestation', () => {
  beforeEach(() => {
    buildSpy.mockClear();
    addSpy.mockClear();
    publishSpy.mockClear();
  });

  it('builds the 1063 template, signs, adds to store, publishes, and returns the signed event', async () => {
    const signEvent = vi.fn(async (tmpl) => ({ ...tmpl, id: 'evid', sig: 'sig' }));
    const signer = { pubkey: 'signerpub', signEvent };

    const signed = await publishLicenseAttestation(input, signer);

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy.mock.calls[0][0]).toMatchObject({ kind: 1063 });
    expect(signEvent).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(signed);
    expect(publishSpy).toHaveBeenCalledWith(signed, [], {});
    expect(signed.id).toBe('evid');
  });

  it('throws when no signer is provided', async () => {
    await expect(publishLicenseAttestation(input, null)).rejects.toThrow();
  });
});
