/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  serviceLabel,
  modelLabel,
  effectiveChoice,
  nextCandidate,
  isOutside,
  fallbackOf,
  normalizeStoredModel,
  chosenModel,
  namesOf,
  hasChoice
} from '../model-choice.js';

const LIST = {
  default: 'saia:glm-5.3',
  models: [
    { id: 'saia:glm-5.3', name: 'GLM 5.3' },
    { id: 'saia:qwen3', name: 'Qwen 3', state: /** @type {const} */ ('down') },
    { id: 'saia:llama', name: 'Llama' }
  ],
  external: { models: [{ id: 'anthropic:claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }] }
};
const INSIDE = { default: LIST.default, models: LIST.models };

describe('labels', () => {
  it('serviceLabel names the service by the id prefix', () => {
    expect(serviceLabel('saia:glm-5.3')).toBe('SAIA (GWDG)');
    expect(serviceLabel('anthropic:claude-sonnet-5-5')).toBe('Anthropic (USA)');
  });
  it('modelLabel: the listed name, else the bare model', () => {
    expect(modelLabel('saia:glm-5.3', { 'saia:glm-5.3': 'GLM 5.3' })).toBe('GLM 5.3');
    expect(modelLabel('saia:glm-5.3', {})).toBe('glm-5.3');
    expect(modelLabel('junk', {})).toBe('junk');
  });
  it('isOutside: anthropic ids only', () => {
    expect(isOutside('anthropic:x')).toBe(true);
    expect(isOutside('saia:x')).toBe(false);
    expect(isOutside('anthropicx')).toBe(false);
  });
});

describe('effectiveChoice', () => {
  it('a stored id still offered wins', () => {
    expect(effectiveChoice('saia:llama', LIST)).toBe('saia:llama');
    expect(effectiveChoice('anthropic:claude-sonnet-5-5', LIST)).toBe(
      'anthropic:claude-sonnet-5-5'
    );
  });
  it('nothing stored, a stale id or garbage → the default', () => {
    expect(effectiveChoice(null, LIST)).toBe('saia:glm-5.3');
    expect(effectiveChoice('saia:gone', LIST)).toBe('saia:glm-5.3');
    expect(effectiveChoice('<b>', LIST)).toBe('saia:glm-5.3');
  });
  it('an outside id for an account without `external` → the default', () => {
    expect(effectiveChoice('anthropic:claude-sonnet-5-5', INSIDE)).toBe('saia:glm-5.3');
  });
});

describe('nextCandidate (the server tries the chosen model, then the others in list order)', () => {
  it('the first other model in list order, skipping down ones', () => {
    expect(nextCandidate('saia:glm-5.3', LIST)).toBe('saia:llama');
    expect(nextCandidate('saia:llama', LIST)).toBe('saia:glm-5.3');
  });
  it('none for an outside model or a single-model list', () => {
    expect(nextCandidate('anthropic:claude-sonnet-5-5', LIST)).toBeUndefined();
    expect(
      nextCandidate('saia:glm-5.3', { default: 'saia:glm-5.3', models: [LIST.models[0]] })
    ).toBeUndefined();
  });
});

describe('fallbackOf (wire metadata → the turn field)', () => {
  it('maps chosen/reason to from/reason', () => {
    expect(fallbackOf({ model: 'saia:llama', chosen: 'saia:glm-5.3', reason: 'capacity' })).toEqual(
      { from: 'saia:glm-5.3', reason: 'capacity' }
    );
    expect(fallbackOf({ chosen: 'saia:glm-5.3', reason: 'no_start' })).toEqual({
      from: 'saia:glm-5.3',
      reason: 'no_start'
    });
  });
  it.each([
    undefined,
    null,
    {},
    { model: 'saia:glm-5.3', chosen: null, reason: null },
    { chosen: 'saia:glm-5.3', reason: null },
    { chosen: 'saia:glm-5.3', reason: 'other' },
    { chosen: 'glm 5', reason: 'capacity' },
    { chosen: '<script>', reason: 'capacity' }
  ])('absent or invalid → undefined (%j)', (meta) => expect(fallbackOf(meta)).toBeUndefined());
});

describe('normalizeStoredModel', () => {
  it('keeps a prefixed id, reads an old bare id as saia:, drops garbage', () => {
    expect(normalizeStoredModel('anthropic:claude-sonnet-5-5')).toBe('anthropic:claude-sonnet-5-5');
    expect(normalizeStoredModel('glm-5.3')).toBe('saia:glm-5.3');
    expect(normalizeStoredModel('a b')).toBeUndefined();
    expect(normalizeStoredModel('openai:gpt')).toBeUndefined();
    expect(normalizeStoredModel(5)).toBeUndefined();
    expect(normalizeStoredModel('')).toBeUndefined();
  });
});

describe('chosenModel (the id the next request carries)', () => {
  it('the offered choice; an outside one only after the confirm', () => {
    expect(chosenModel('saia:llama', LIST, false)).toBe('saia:llama');
    expect(chosenModel('anthropic:claude-sonnet-5-5', LIST, false)).toBe('saia:glm-5.3');
    expect(chosenModel('anthropic:claude-sonnet-5-5', LIST, true)).toBe(
      'anthropic:claude-sonnet-5-5'
    );
    expect(chosenModel(null, LIST, true)).toBe('saia:glm-5.3');
  });
});

describe('namesOf / hasChoice', () => {
  it('names every offered id', () => {
    expect(namesOf(LIST)).toEqual({
      'saia:glm-5.3': 'GLM 5.3',
      'saia:qwen3': 'Qwen 3',
      'saia:llama': 'Llama',
      'anthropic:claude-sonnet-5-5': 'Claude Sonnet 5.5'
    });
    expect(namesOf(null)).toEqual({});
  });
  it('a choice exists with two models or an outside group', () => {
    expect(hasChoice(LIST)).toBe(true);
    expect(hasChoice(null)).toBe(false);
    const one = { default: 'saia:a', models: [{ id: 'saia:a', name: 'A' }] };
    expect(hasChoice(one)).toBe(false);
    expect(hasChoice({ ...one, external: { models: [] } })).toBe(false);
    expect(hasChoice({ ...one, external: LIST.external })).toBe(true);
  });
});
