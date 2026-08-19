/** @vitest-environment node */
// @ts-nocheck -- vi.mock factory mocks aren't inferred as Mock (see nip05-verify.test.js)
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/image-license.js', () => ({ findExistingLicense: vi.fn() }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: vi.fn(async () => ({ success: true }))
}));

import {
  findInteractiveEncoding,
  resourceAppKey,
  deleteCompanionLicense,
  seedInteractivePackageFromEncodings
} from '../interactiveResource.js';
import { findExistingLicense } from '$lib/helpers/image-license.js';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';

describe('findInteractiveEncoding', () => {
  it('returns the x-webxdc encoding', () => {
    const resource = {
      encodings: [
        { mimeType: 'application/pdf' },
        { mimeType: 'application/x-webxdc', sha256: 'aa' }
      ]
    };
    expect(findInteractiveEncoding(resource)?.sha256).toBe('aa');
    expect(findInteractiveEncoding({ encodings: [] })).toBeNull();
    expect(findInteractiveEncoding(null)).toBeNull();
  });
});

describe('seedInteractivePackageFromEncodings', () => {
  it('builds an InteractivePackage from the x-webxdc encoding (draft/formData shape)', () => {
    const licenseEvent = { id: 'e', kind: 1063 };
    const encodings = [
      { url: 'https://blossom/a.pdf', name: 'a', type: 'application/pdf', size: 1, sha256: 'bb' },
      {
        url: 'https://blossom/x.xdc',
        name: 'Quiz',
        type: 'application/x-webxdc',
        size: 42,
        sha256: 'aa',
        licenseEvent
      }
    ];
    expect(seedInteractivePackageFromEncodings(encodings)).toEqual({
      url: 'https://blossom/x.xdc',
      name: 'Quiz',
      type: 'application/x-webxdc',
      size: 42,
      sha256: 'aa',
      licenseEvent,
      iconUrl: ''
    });
  });

  it('returns null when there is no x-webxdc encoding', () => {
    expect(seedInteractivePackageFromEncodings([{ type: 'application/pdf' }])).toBeNull();
    expect(seedInteractivePackageFromEncodings([])).toBeNull();
    expect(seedInteractivePackageFromEncodings(undefined)).toBeNull();
    expect(seedInteractivePackageFromEncodings(null)).toBeNull();
  });
});

describe('resourceAppKey', () => {
  it('builds kind:pubkey:d', () => {
    const event = { kind: 30142, pubkey: 'pk', tags: [['d', 'https://x/app.xdc']] };
    expect(resourceAppKey(event)).toBe('30142:pk:https://x/app.xdc');
  });
});

describe('deleteCompanionLicense', () => {
  const user = { pubkey: 'me', signEvent: vi.fn() };

  it('deletes an own license event', async () => {
    const lic = { id: 'l1', kind: 1063, pubkey: 'me' };
    findExistingLicense.mockResolvedValueOnce(lic);
    await deleteCompanionLicense('aa', user);
    expect(deleteEvent).toHaveBeenCalledWith(lic, user);
  });

  it('skips foreign or missing license events and swallows errors', async () => {
    findExistingLicense.mockResolvedValueOnce({ id: 'l2', pubkey: 'other' });
    await deleteCompanionLicense('aa', user);
    findExistingLicense.mockRejectedValueOnce(new Error('relay down'));
    await expect(deleteCompanionLicense('aa', user)).resolves.toBeUndefined();
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });
});
