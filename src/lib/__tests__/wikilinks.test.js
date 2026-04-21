/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { preprocessWikilinks } from '$lib/helpers/markdownNostr.js';

describe('preprocessWikilinks', () => {
  it('converts [[target]] to a markdown link with normalized target', () => {
    const result = preprocessWikilinks('See [[Bitcoin]]');
    expect(result).toBe('See [Bitcoin](/wiki/bitcoin)');
  });

  it('converts [[target|label]] to a markdown link with label', () => {
    const result = preprocessWikilinks('See [[Bitcoin|BTC info]]');
    expect(result).toBe('See [BTC info](/wiki/bitcoin)');
  });

  it('normalizes target with spaces to hyphens', () => {
    const result = preprocessWikilinks('Read [[Proof of Work]]');
    expect(result).toBe('Read [Proof of Work](/wiki/proof-of-work)');
  });

  it('handles multiple wikilinks in one string', () => {
    const result = preprocessWikilinks('Compare [[Bitcoin]] and [[Ethereum]]');
    expect(result).toBe('Compare [Bitcoin](/wiki/bitcoin) and [Ethereum](/wiki/ethereum)');
  });

  it('handles mixed labeled and unlabeled wikilinks', () => {
    const result = preprocessWikilinks('See [[Bitcoin|BTC]] and [[Ethereum]]');
    expect(result).toBe('See [BTC](/wiki/bitcoin) and [Ethereum](/wiki/ethereum)');
  });

  it('handles unicode targets', () => {
    const result = preprocessWikilinks('See [[Ñoño]]');
    expect(result).toContain('[Ñoño]');
    expect(result).toContain('/wiki/');
  });

  it('returns empty string for empty/null input', () => {
    expect(preprocessWikilinks('')).toBe('');
    expect(preprocessWikilinks(null)).toBe('');
    expect(preprocessWikilinks(undefined)).toBe('');
  });

  it('does not match single brackets', () => {
    const result = preprocessWikilinks('array[0] and [link](url)');
    expect(result).toBe('array[0] and [link](url)');
  });

  it('trims whitespace in target and label', () => {
    const result = preprocessWikilinks('See [[ Bitcoin | BTC info ]]');
    expect(result).toBe('See [BTC info](/wiki/bitcoin)');
  });

  it('normalizes special characters via NIP-54', () => {
    const result = preprocessWikilinks('See [[C++]]');
    // normalizeIdentifier converts + to - and lowercases
    expect(result).toBe('See [C++](/wiki/c--)');
  });

  it('leaves text without wikilinks unchanged', () => {
    const text = 'Just plain text with no links';
    expect(preprocessWikilinks(text)).toBe(text);
  });
});
