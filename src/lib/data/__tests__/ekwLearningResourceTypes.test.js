import { describe, it, expect } from 'vitest';
import { EKW_LEARNING_RESOURCE_TYPES, EKW_LRT_ID_PREFIX } from '../ekwLearningResourceTypes.js';

describe('EKW_LEARNING_RESOURCE_TYPES', () => {
  it('is non-empty', () => {
    expect(EKW_LEARNING_RESOURCE_TYPES.length).toBeGreaterThan(0);
  });

  it('contains a known childless parent leaf', () => {
    const arbeitsblatt = EKW_LEARNING_RESOURCE_TYPES.find((l) => l.label === 'Arbeitsblatt');
    expect(arbeitsblatt).toBeDefined();
    expect(arbeitsblatt?.parentLabel).toBeNull();
  });

  it('contains a known parent-scoped child leaf', () => {
    const erklaerAudio = EKW_LEARNING_RESOURCE_TYPES.find(
      (l) => l.label === 'Erklär-Audio' && l.parentLabel === 'Audio'
    );
    expect(erklaerAudio).toBeDefined();
  });

  it('contains "Stationenlernen" as a childless parent leaf', () => {
    const stat = EKW_LEARNING_RESOURCE_TYPES.find((l) => l.label === 'Stationenlernen');
    expect(stat).toBeDefined();
    expect(stat?.parentLabel).toBeNull();
  });

  it('does not duplicate ids', () => {
    const ids = EKW_LEARNING_RESOURCE_TYPES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('namespaces every id with the EKW LRT prefix', () => {
    for (const leaf of EKW_LEARNING_RESOURCE_TYPES) {
      expect(leaf.id.startsWith(EKW_LRT_ID_PREFIX)).toBe(true);
    }
  });

  it('parent-scopes every child id under <parent-slug>/<child-slug>', () => {
    // Childless parents have ids like ".../arbeitsblatt".
    // Children under a parent have ids like ".../audio/erklaer-audio".
    // The parent-scoped form prevents two children of different parents
    // from colliding if they happen to share a label (e.g. "Beispiel").
    const children = EKW_LEARNING_RESOURCE_TYPES.filter((l) => l.parentLabel !== null);
    expect(children.length).toBeGreaterThan(0);
    for (const leaf of children) {
      const tail = leaf.id.slice(EKW_LRT_ID_PREFIX.length);
      expect(tail.includes('/')).toBe(true);
    }
  });
});
