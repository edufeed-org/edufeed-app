/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeServerUrl,
  urlIsOnTrustedServer,
  reconcileBlobUrlScheme
} from '$lib/helpers/blossom-trust.js';

describe('normalizeServerUrl', () => {
  it('drops the scheme and lowercases the host', () => {
    expect(normalizeServerUrl('https://Blossom.EDUFEED.org/')).toBe('blossom.edufeed.org');
  });

  it('drops the scheme but preserves path case', () => {
    expect(normalizeServerUrl('https://blossom.edufeed.org/Path')).toBe('blossom.edufeed.org/Path');
  });

  it('treats http and https on the same host as equal', () => {
    expect(normalizeServerUrl('http://blossom.edufeed.org')).toBe(
      normalizeServerUrl('https://blossom.edufeed.org')
    );
  });

  it('strips trailing slash from bare host', () => {
    expect(normalizeServerUrl('https://blossom.edufeed.org/')).toBe('blossom.edufeed.org');
  });

  it('keeps explicit port', () => {
    expect(normalizeServerUrl('http://blossom.edufeed.org:8080/path')).toBe(
      'blossom.edufeed.org:8080/path'
    );
  });

  it('passes through invalid input unchanged', () => {
    expect(normalizeServerUrl('')).toBe('');
    expect(normalizeServerUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('urlIsOnTrustedServer', () => {
  const servers = ['https://blossom.edufeed.org', 'https://files.example.org'];

  it('matches exact server URL', () => {
    expect(urlIsOnTrustedServer('https://blossom.edufeed.org', servers)).toBe(true);
  });

  it('matches a path under a trusted server', () => {
    expect(urlIsOnTrustedServer('https://blossom.edufeed.org/abc123.png', servers)).toBe(true);
  });

  it('matches case-insensitively on host', () => {
    expect(urlIsOnTrustedServer('https://BLOSSOM.edufeed.org/abc.png', servers)).toBe(true);
  });

  it('matches a different trusted server', () => {
    expect(urlIsOnTrustedServer('https://files.example.org/x.png', servers)).toBe(true);
  });

  it('matches http URL against an https trusted entry (scheme-insensitive)', () => {
    expect(urlIsOnTrustedServer('http://blossom.edufeed.org/abc.png', servers)).toBe(true);
  });

  it('matches https URL against an http trusted entry (scheme-insensitive)', () => {
    expect(
      urlIsOnTrustedServer('https://blossom.edufeed.org/abc.png', ['http://blossom.edufeed.org'])
    ).toBe(true);
  });

  it('rejects look-alike domain', () => {
    expect(urlIsOnTrustedServer('https://blossom.edufeed.org.evil.com/x.png', servers)).toBe(false);
  });

  it('rejects untrusted server', () => {
    expect(urlIsOnTrustedServer('https://random.host/x.png', servers)).toBe(false);
  });

  it('returns false for empty server list', () => {
    expect(urlIsOnTrustedServer('https://blossom.edufeed.org/x.png', [])).toBe(false);
  });

  it('returns false for empty url', () => {
    expect(urlIsOnTrustedServer('', servers)).toBe(false);
  });

  it('tolerates trailing slash in trusted server entry', () => {
    expect(
      urlIsOnTrustedServer('https://blossom.edufeed.org/x.png', ['https://blossom.edufeed.org/'])
    ).toBe(true);
  });
});

describe('reconcileBlobUrlScheme', () => {
  it('rewrites http blob URL to https when we uploaded over https on the same host', () => {
    expect(
      reconcileBlobUrlScheme('http://blossom.edufeed.org/abc.png', 'https://blossom.edufeed.org/')
    ).toBe('https://blossom.edufeed.org/abc.png');
  });

  it('rewrites https blob URL to http when we uploaded over http on the same host', () => {
    expect(reconcileBlobUrlScheme('https://blossom.local/abc.png', 'http://blossom.local')).toBe(
      'http://blossom.local/abc.png'
    );
  });

  it('leaves blob URL unchanged when hostnames differ', () => {
    expect(
      reconcileBlobUrlScheme('http://cdn.other.host/abc.png', 'https://blossom.edufeed.org')
    ).toBe('http://cdn.other.host/abc.png');
  });

  it('leaves blob URL unchanged when schemes already match', () => {
    expect(
      reconcileBlobUrlScheme('https://blossom.edufeed.org/abc.png', 'https://blossom.edufeed.org/')
    ).toBe('https://blossom.edufeed.org/abc.png');
  });

  it('matches hostname case-insensitively (result hostname is lowercased by URL parser)', () => {
    expect(
      reconcileBlobUrlScheme('http://Blossom.Edufeed.ORG/abc.png', 'https://blossom.edufeed.org')
    ).toBe('https://blossom.edufeed.org/abc.png');
  });

  it('returns blob URL unchanged on parse failure', () => {
    expect(reconcileBlobUrlScheme('not-a-url', 'https://blossom.edufeed.org')).toBe('not-a-url');
  });

  it('returns blob URL unchanged when uploadServerUrl is empty', () => {
    expect(reconcileBlobUrlScheme('http://blossom.edufeed.org/abc.png', '')).toBe(
      'http://blossom.edufeed.org/abc.png'
    );
  });

  it('returns empty string when blob URL is empty', () => {
    expect(reconcileBlobUrlScheme('', 'https://blossom.edufeed.org')).toBe('');
  });
});
