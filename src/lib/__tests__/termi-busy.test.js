/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { busyGroup } from '$lib/termi/busy.js';

/** @param {string} name @param {string} [state] */
const running = (name, state = 'input-available') => ({ type: `tool-${name}`, state });

describe('busyGroup', () => {
  it('names the group of the tool that is running', () => {
    expect(busyGroup([running('search_passages')])).toBe('material');
    expect(busyGroup([running('search_curriculum')])).toBe('curriculum');
    expect(busyGroup([running('find_curriculum', 'input-streaming')])).toBe('curriculum');
    expect(busyGroup([running('find_community')])).toBe('people');
    expect(
      busyGroup([{ type: 'dynamic-tool', toolName: 'find_people', state: 'input-available' }])
    ).toBe('people');
  });
  it('is writing when nothing runs (finished tools, text, action tools, no parts)', () => {
    expect(busyGroup([running('search_content', 'output-available'), { type: 'text' }])).toBe(
      'writing'
    );
    expect(busyGroup([running('lesson_state')])).toBe('writing');
    expect(busyGroup([])).toBe('writing');
    expect(busyGroup(undefined)).toBe('writing');
  });
  it('takes the latest running tool', () => {
    expect(busyGroup([running('search_content'), running('find_curriculum')])).toBe('curriculum');
  });
});
