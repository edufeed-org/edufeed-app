/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
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
});
