/**
 * Shared relay-input normalizer — the single gate every "type a relay URL"
 * field runs through.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { normalizeRelayInput } from '../helpers/relay-input.js';

describe('normalizeRelayInput', () => {
  it('prepends wss:// to bare hostnames', () => {
    expect(normalizeRelayInput('relay.example.org')).toBe('wss://relay.example.org/');
  });

  it('prepends wss:// to a bare host with a port', () => {
    expect(normalizeRelayInput('relay.example.org:4848')).toBe('wss://relay.example.org:4848/');
  });

  it('prepends wss:// to a bare host with a path', () => {
    expect(normalizeRelayInput('relay.example.org/inbox')).toBe('wss://relay.example.org/inbox');
  });

  it('normalizes an explicit wss URL (trailing slash, lowercase host)', () => {
    expect(normalizeRelayInput('wss://Relay.Example.ORG')).toBe('wss://relay.example.org/');
  });

  it('accepts ws:// (e.g. localhost dev relays)', () => {
    expect(normalizeRelayInput('ws://localhost:7777')).toBe('ws://localhost:7777/');
  });

  it('does NOT upgrade an explicit ws:// to wss:// — dev relays have no TLS', () => {
    expect(normalizeRelayInput('ws://127.0.0.1:10547')).toBe('ws://127.0.0.1:10547/');
  });

  it('defaults a bare localhost to wss:// (explicit ws:// stays the opt-in)', () => {
    expect(normalizeRelayInput('localhost:7777')).toBe('wss://localhost:7777/');
  });

  it('rejects non-websocket schemes', () => {
    expect(normalizeRelayInput('https://relay.example.org')).toBeNull();
    expect(normalizeRelayInput('http://relay.example.org')).toBeNull();
  });

  it('rejects empty, whitespace-only, and non-string input', () => {
    expect(normalizeRelayInput('')).toBeNull();
    expect(normalizeRelayInput('   ')).toBeNull();
    expect(normalizeRelayInput(null)).toBeNull();
    expect(normalizeRelayInput(undefined)).toBeNull();
    expect(normalizeRelayInput(/** @type {any} */ (42))).toBeNull();
  });

  it('rejects unparseable garbage', () => {
    expect(normalizeRelayInput('not a relay url')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeRelayInput('  relay.example.org  ')).toBe('wss://relay.example.org/');
  });

  it('rejects hostnames containing percent-encoding', () => {
    expect(normalizeRelayInput('not%20a%20relay')).toBeNull();
    expect(normalizeRelayInput('wss://not%20a%20relay')).toBeNull();
  });

  it('rejects input with internal whitespace even if the URL parser accepts it', () => {
    expect(normalizeRelayInput('wss://not a relay')).toBeNull();
    // WHATWG parsers (Node AND browsers) silently strip tabs/newlines
    expect(normalizeRelayInput('wss://not\ta\trelay')).toBeNull();
  });

  describe('trailingSlash: false', () => {
    it('drops the root slash normalizeURL adds', () => {
      expect(normalizeRelayInput('relay.example.org', { trailingSlash: false })).toBe(
        'wss://relay.example.org'
      );
      expect(normalizeRelayInput('wss://relay.example.org/', { trailingSlash: false })).toBe(
        'wss://relay.example.org'
      );
    });

    it('leaves a non-root path alone', () => {
      expect(normalizeRelayInput('relay.example.org/inbox', { trailingSlash: false })).toBe(
        'wss://relay.example.org/inbox'
      );
    });

    it('keeps a trailing slash that is part of a path — only the root slash goes', () => {
      // normalizeURL preserves "/inbox/"; stripping it would point at a
      // different resource on relays that route by path.
      expect(normalizeRelayInput('relay.example.org/inbox/', { trailingSlash: false })).toBe(
        'wss://relay.example.org/inbox/'
      );
    });

    it('still rejects invalid input', () => {
      expect(normalizeRelayInput('https://relay.example.org', { trailingSlash: false })).toBeNull();
      expect(normalizeRelayInput('', { trailingSlash: false })).toBeNull();
    });

    it('is idempotent — normalizing its own output is a no-op', () => {
      const once = normalizeRelayInput('Relay.Example.ORG', { trailingSlash: false });
      expect(normalizeRelayInput(/** @type {string} */ (once), { trailingSlash: false })).toBe(
        once
      );
    });
  });
});
