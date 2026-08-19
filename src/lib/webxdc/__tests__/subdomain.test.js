/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { sandboxSubdomain } from '../subdomain.js';

describe('sandboxSubdomain', () => {
  beforeEach(() => localStorage.clear());

  it('is stable for the same appKey and seed', () => {
    expect(sandboxSubdomain('30142:pk:app-1')).toBe(sandboxSubdomain('30142:pk:app-1'));
  });

  it('differs per appKey', () => {
    expect(sandboxSubdomain('a')).not.toBe(sandboxSubdomain('b'));
  });

  it('is a valid DNS label', () => {
    const label = sandboxSubdomain('30142:pk:app-1');
    expect(label).toMatch(/^[a-z0-9]{1,63}$/);
  });

  it('changes when the device seed changes', () => {
    const first = sandboxSubdomain('a');
    localStorage.clear();
    expect(sandboxSubdomain('a')).not.toBe(first);
  });

  describe('fallback path (localStorage unavailable)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns a valid DNS label when localStorage is blocked', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });

      const label = sandboxSubdomain('test-app');
      expect(label).toMatch(/^[a-z0-9]{1,63}$/);
    });

    it('is stable across calls within the same session', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });

      const first = sandboxSubdomain('test-app');
      const second = sandboxSubdomain('test-app');
      expect(first).toBe(second);
    });

    it('differs between different module instances (sessions)', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });

      const firstSessionLabel = sandboxSubdomain('test-app');

      // Reset modules to simulate a new session
      vi.resetModules();
      const { sandboxSubdomain: sandboxSubdomainNewSession } = await import('../subdomain.js');

      // Mock localStorage again for the new session
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage blocked');
      });

      const secondSessionLabel = sandboxSubdomainNewSession('test-app');
      expect(firstSessionLabel).not.toBe(secondSessionLabel);
    });
  });
});
