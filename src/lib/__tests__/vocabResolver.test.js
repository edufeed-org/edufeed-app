/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

const PUBKEY = 'a'.repeat(64);
const VOCAB_KIND = 39737; // nostr-vocab-core CONCEPT_KIND for ConceptScheme

/**
 * @param {string} identifier
 * @param {string[]} [relays]
 */
function makeNaddr(identifier, relays = ['wss://vocab.example']) {
  return nip19.naddrEncode({ pubkey: PUBKEY, kind: VOCAB_KIND, identifier, relays });
}

describe('resolveVocabField', () => {
  /** @type {(key: string) => any} */
  let resolveVocabField;

  beforeEach(async () => {
    vi.resetModules();
    const SCHULE_NADDR = makeNaddr('schulfaecher');
    const HOCHSCHULE_NADDR = makeNaddr('hochschulfaecher');
    const EDUCATIONAL_LEVEL_NADDR = makeNaddr('educationalLevel');

    vi.doMock('$lib/stores/config.svelte.js', () => ({
      runtimeConfig: {
        get educational() {
          return {
            schemeNaddrs: {
              schulfaecher: SCHULE_NADDR,
              hochschulfaecher: HOCHSCHULE_NADDR,
              educationalLevel: EDUCATIONAL_LEVEL_NADDR,
              hcrt: '',
              newLrt: '',
              lrmiAudience: '',
              interactivityType: '',
              conditionsOfAccess: ''
            }
          };
        }
      }
    }));

    ({ resolveVocabField } = await import('$lib/helpers/educational/vocabResolver.js'));
  });

  it('returns null for an unknown key', () => {
    expect(resolveVocabField('totally-unknown')).toBeNull();
  });

  it('returns null when the naddr env var is empty', () => {
    expect(resolveVocabField('hcrt')).toBeNull();
  });

  it('decodes schulfaecher naddr into a FormConceptPicker-compatible vocab field', () => {
    const field = resolveVocabField('schulfaecher');
    expect(field).not.toBeNull();
    expect(field.vocab.address).toBe(`${VOCAB_KIND}:${PUBKEY}:schulfaecher`);
    expect(field.vocab.relay).toBe('wss://vocab.example');
    // field.type should be a concept-picker-compatible type
    expect(field.type).toBe('concept-picker');
    // field.id should be stable and derivable from the key
    expect(field.id).toBe('schulfaecher');
  });

  it('passes through an empty relay when naddr carries no relays', () => {
    const noRelayNaddr = nip19.naddrEncode({
      pubkey: PUBKEY,
      kind: VOCAB_KIND,
      identifier: 'educationalLevel',
      relays: []
    });
    vi.resetModules();
    vi.doMock('$lib/stores/config.svelte.js', () => ({
      runtimeConfig: {
        get educational() {
          return {
            schemeNaddrs: { educationalLevel: noRelayNaddr }
          };
        }
      }
    }));
    return import('$lib/helpers/educational/vocabResolver.js').then(({ resolveVocabField }) => {
      const field = resolveVocabField('educationalLevel');
      expect(field?.vocab.relay).toBe('');
    });
  });
});
