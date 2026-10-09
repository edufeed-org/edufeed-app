// @ts-nocheck
/**
 * The translated names of the bundled call backgrounds live in one place
 * (groups/call-background-labels) so the lobby and the in-call camera menu
 * cannot drift: a preset added to BACKGROUND_PRESETS without a label would
 * otherwise show its raw id in one surface and a translation in the other.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { BACKGROUND_PRESETS } from '$lib/groups/call-background.js';
import { backgroundPresetLabel } from '$lib/groups/call-background-labels.js';
import preJoinSource from '../components/groups/call/CallPreJoin.svelte?raw';
import stageSource from '../components/groups/call/GroupCallStage.svelte?raw';

describe('backgroundPresetLabel', () => {
  it('names every bundled preset', () => {
    for (const preset of BACKGROUND_PRESETS) {
      const label = backgroundPresetLabel(preset.id);
      expect(label, preset.id).toBeTypeOf('function');
      expect(label(), preset.id).not.toBe('');
      expect(label(), preset.id).not.toBe(preset.id);
    }
  });

  it('falls back to the id for an unknown preset', () => {
    expect(backgroundPresetLabel('nope')()).toBe('nope');
  });

  it.each([
    ['CallPreJoin', preJoinSource],
    ['GroupCallStage', stageSource]
  ])('%s has no label table of its own', (_name, source) => {
    expect(source).not.toMatch(/PRESET_LABELS/);
    expect(source).toMatch(/backgroundPresetLabel/);
  });
});
