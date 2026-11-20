/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseModelId, serviceOf } from '../model-id.js';

describe('parseModelId', () => {
  it('splits saia: and anthropic: ids', () => {
    expect(parseModelId('saia:glm-5.3')).toEqual({ service: 'saia', model: 'glm-5.3' });
    expect(parseModelId('anthropic:claude-sonnet-5-5')).toEqual({
      service: 'anthropic',
      model: 'claude-sonnet-5-5'
    });
  });
  it.each(['claude-x', 'openai:gpt', 'saia:', 'saia:a b', 'saia:' + 'x'.repeat(81), 5, null])(
    'rejects %s',
    (id) => expect(parseModelId(id)).toBeNull()
  );
  it('serviceOf', () => {
    expect(serviceOf('anthropic:x')).toBe('anthropic');
    expect(serviceOf('x')).toBeNull();
  });
});
