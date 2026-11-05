// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { isHttpUrl, safeInternalPath } from '$lib/helpers/safeUrl.js';

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://example.com/image.jpg')).toBe(true);
    expect(isHttpUrl('http://example.com/image.jpg')).toBe(true);
  });

  it('rejects javascript: and other schemes', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isHttpUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects non-strings, empty and relative values', () => {
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
    expect(isHttpUrl('/relative/path.jpg')).toBe(false);
    expect(isHttpUrl(' javascript:alert(1)')).toBe(false);
  });
});

describe('safeInternalPath', () => {
  it('keeps in-app paths with query and hash', () => {
    expect(safeInternalPath('/c/abc?tab=forms#x')).toBe('/c/abc?tab=forms#x');
  });

  it('rejects other schemes and off-origin paths', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBe(null);
    expect(safeInternalPath('https://phish.example/')).toBe(null);
    expect(safeInternalPath('//evil.example/x')).toBe(null);
    expect(safeInternalPath('/\\evil.example')).toBe(null);
    expect(safeInternalPath('/\t/evil.example')).toBe(null);
    expect(safeInternalPath('')).toBe(null);
    expect(safeInternalPath(null)).toBe(null);
  });
});
