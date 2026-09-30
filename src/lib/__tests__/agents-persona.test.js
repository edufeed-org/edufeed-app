/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  PERSONA_KIND,
  AGENT_RECORD_KIND,
  personaSlugForAgent,
  validatePersona,
  buildPersonaTemplate,
  buildAgentRecordTemplate,
  parsePersona,
  parseAgentRecord,
  agentRecordAddress,
  personaAddress,
  buildAgentDeletionTemplate
} from '$lib/agents/persona.js';

const OWNER = 'a'.repeat(64);
const AGENT = 'b'.repeat(64);

describe('personaSlugForAgent', () => {
  it('derives an NIP-AP grammar-safe slug from the agent pubkey', () => {
    expect(personaSlugForAgent(AGENT)).toBe('agent-' + 'b'.repeat(12));
  });
});

describe('validatePersona', () => {
  const good = {
    displayName: 'Lehrbot',
    systemPrompt: 'Hilf beim Lernen.',
    runtime: 'claude',
    avatarUrl: '',
    respondTo: 'owner-only'
  };
  it('accepts a complete persona', () => {
    expect(validatePersona(good)).toEqual({ ok: true, value: good });
  });
  it('accepts any non-empty name, including punctuation-only text', () => {
    expect(validatePersona({ ...good, displayName: '!!!' })).toEqual({
      ok: true,
      value: { ...good, displayName: '!!!' }
    });
  });
  it('refuses a blank or whitespace-only name', () => {
    expect(validatePersona({ ...good, displayName: '   ' })).toEqual({
      ok: false,
      error: 'name'
    });
    expect(validatePersona({ ...good, displayName: '' })).toEqual({ ok: false, error: 'name' });
  });
  it('refuses unknown runtime and respond-to values', () => {
    expect(validatePersona({ ...good, runtime: 'goose' })).toEqual({ ok: false, error: 'runtime' });
    expect(validatePersona({ ...good, respondTo: 'allowlist' })).toEqual({
      ok: false,
      error: 'respondTo'
    });
  });
});

describe('templates', () => {
  it('builds the persona event in Buzz NIP-AP shape', () => {
    const t = buildPersonaTemplate({
      slug: 'lehrbot',
      displayName: 'Lehrbot',
      systemPrompt: 'Hilf.',
      runtime: 'claude',
      avatarUrl: 'https://x/y.png',
      respondTo: 'anyone'
    });
    expect(t.kind).toBe(PERSONA_KIND);
    expect(t.tags).toEqual([
      ['d', 'lehrbot'],
      ['alt', 'agent persona definition']
    ]);
    expect(JSON.parse(t.content)).toEqual({
      display_name: 'Lehrbot',
      system_prompt: 'Hilf.',
      runtime: 'claude',
      avatar_url: 'https://x/y.png',
      respond_to: 'anyone',
      respond_to_allowlist: [],
      session_policy: 'channel'
    });
    expect(typeof t.created_at).toBe('number');
  });

  it('builds the ownership record keyed by the agent pubkey', () => {
    const t = buildAgentRecordTemplate({
      agentPubkey: AGENT,
      name: 'Lehrbot',
      definition: 'lehrbot',
      respondTo: 'owner-only'
    });
    expect(t.kind).toBe(AGENT_RECORD_KIND);
    expect(t.tags).toEqual([
      ['d', AGENT],
      ['alt', 'agent ownership record']
    ]);
    expect(JSON.parse(t.content)).toEqual({
      name: 'Lehrbot',
      definition: 'lehrbot',
      respond_to: 'owner-only',
      respond_to_allowlist: []
    });
  });

  it('avatar_url is null when empty', () => {
    const t = buildPersonaTemplate({
      slug: 'a',
      displayName: 'A',
      systemPrompt: '',
      runtime: 'codex',
      avatarUrl: '',
      respondTo: 'owner-only'
    });
    expect(JSON.parse(t.content).avatar_url).toBeNull();
  });

  it('builds the deletion for both records', () => {
    const t = buildAgentDeletionTemplate({
      ownerPubkey: OWNER,
      agentPubkey: AGENT,
      slug: 'lehrbot'
    });
    expect(t.kind).toBe(5);
    expect(t.tags).toEqual([
      ['a', `30177:${OWNER}:${AGENT}`],
      ['a', `30175:${OWNER}:lehrbot`]
    ]);
  });
});

describe('parsers', () => {
  it('round-trips a persona and ignores unknown fields', () => {
    const t = buildPersonaTemplate({
      slug: 'lehrbot',
      displayName: 'Lehrbot',
      systemPrompt: 'Hilf.',
      runtime: 'claude',
      avatarUrl: null,
      respondTo: 'owner-only'
    });
    const content = JSON.stringify({ ...JSON.parse(t.content), model: 'claude-opus-5' });
    expect(parsePersona({ ...t, content, pubkey: OWNER })).toEqual({
      slug: 'lehrbot',
      displayName: 'Lehrbot',
      systemPrompt: 'Hilf.',
      runtime: 'claude',
      avatarUrl: null,
      respondTo: 'owner-only'
    });
  });
  it('returns null for wrong kind, missing d, or malformed JSON', () => {
    expect(parsePersona({ kind: 1, tags: [['d', 'x']], content: '{}' })).toBeNull();
    expect(parsePersona({ kind: PERSONA_KIND, tags: [], content: '{}' })).toBeNull();
    expect(parsePersona({ kind: PERSONA_KIND, tags: [['d', 'x']], content: '{' })).toBeNull();
  });
  it('parses an ownership record with its owner', () => {
    const t = buildAgentRecordTemplate({
      agentPubkey: AGENT,
      name: 'Lehrbot',
      definition: 'lehrbot',
      respondTo: 'anyone'
    });
    expect(parseAgentRecord({ ...t, pubkey: OWNER })).toEqual({
      agentPubkey: AGENT,
      ownerPubkey: OWNER,
      name: 'Lehrbot',
      definition: 'lehrbot',
      respondTo: 'anyone',
      respondToAllowlist: []
    });
  });
  it('refuses a record whose d is not a pubkey', () => {
    expect(
      parseAgentRecord({
        kind: AGENT_RECORD_KIND,
        pubkey: OWNER,
        tags: [['d', 'nope']],
        content: '{}'
      })
    ).toBeNull();
  });
  it('addresses', () => {
    expect(agentRecordAddress(OWNER, AGENT)).toBe(`30177:${OWNER}:${AGENT}`);
    expect(personaAddress(OWNER, 'lehrbot')).toBe(`30175:${OWNER}:lehrbot`);
  });
});
