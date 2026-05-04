import { describe, it, expect, vi } from 'vitest';
import {
  EKW_LEARNING_RESOURCE_TYPES,
  EKW_LRT_ID_PREFIX,
  toSkosConcepts,
  migrateLrtForEkw
} from '../ekwLearningResourceTypes.js';

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

describe('toSkosConcepts', () => {
  it('returns one concept per leaf in EKW_LEARNING_RESOURCE_TYPES', () => {
    const concepts = toSkosConcepts();
    expect(concepts.length).toBe(EKW_LEARNING_RESOURCE_TYPES.length);
  });

  it('formats children-of-parent leaves as "Parent › Child"', () => {
    const concepts = toSkosConcepts();
    // Note: the slug fn strips combining marks via NFKD, so "Erklär-Audio"
    // becomes "erklar-audio" (NOT "erklaer-audio").
    const erklarAudio = concepts.find((c) => c.id.endsWith('/audio/erklar-audio'));
    expect(erklarAudio).toBeDefined();
    expect(erklarAudio?.labels.de).toBe('Audio › Erklär-Audio');
  });

  it('uses the bare label for childless parent leaves', () => {
    const concepts = toSkosConcepts();
    const arbeitsblatt = concepts.find((c) => c.id.endsWith('/arbeitsblatt'));
    expect(arbeitsblatt).toBeDefined();
    expect(arbeitsblatt?.labels.de).toBe('Arbeitsblatt');
  });

  it('preserves every leaf id verbatim', () => {
    const concepts = toSkosConcepts();
    const leafIds = new Set(EKW_LEARNING_RESOURCE_TYPES.map((l) => l.id));
    for (const concept of concepts) {
      expect(leafIds.has(concept.id)).toBe(true);
    }
  });
});

describe('migrateLrtForEkw', () => {
  it('passes through a concept whose id already starts with EKW_LRT_ID_PREFIX', () => {
    const arbeitsblatt = EKW_LEARNING_RESOURCE_TYPES.find((l) => l.label === 'Arbeitsblatt');
    if (!arbeitsblatt) throw new Error('Arbeitsblatt leaf missing from EKW vocab');
    const result = migrateLrtForEkw([{ id: arbeitsblatt.id, label: arbeitsblatt.label }]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(arbeitsblatt.id);
    expect(result[0].label).toBe(arbeitsblatt.label);
  });

  it('swaps a legacy HCRT id when the label matches an EKW leaf', () => {
    const result = migrateLrtForEkw([
      { id: 'https://w3id.org/kim/hcrt/text', label: 'Sachinformation/Grundlagentext' }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id.startsWith(EKW_LRT_ID_PREFIX)).toBe(true);
    expect(result[0].label).toBe('Sachinformation/Grundlagentext');
  });

  it('matches labels case-insensitively and ignoring extra whitespace', () => {
    const result = migrateLrtForEkw([
      { id: 'https://example.org/legacy', label: '  arbeitsblatt  ' }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Arbeitsblatt');
  });

  it('matches the canonical "Parent › Child" picker label', () => {
    const result = migrateLrtForEkw([
      { id: 'https://example.org/legacy', label: 'Audio › Erklär-Audio' }
    ]);
    expect(result).toHaveLength(1);
    // NFKD-stripped slug → "erklar-audio" (NOT "erklaer-audio")
    expect(result[0].id.endsWith('/audio/erklar-audio')).toBe(true);
  });

  it('drops a concept with no matching label', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = migrateLrtForEkw([
      { id: 'https://w3id.org/kim/hcrt/foo', label: 'Made-Up Type' }
    ]);
    expect(result).toEqual([]);
    warnSpy.mockRestore();
  });

  it('returns [] for null, undefined, and [] without throwing', () => {
    expect(migrateLrtForEkw(null)).toEqual([]);
    expect(migrateLrtForEkw(undefined)).toEqual([]);
    expect(migrateLrtForEkw([])).toEqual([]);
  });

  it('preserves order in a mixed batch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = migrateLrtForEkw([
      { id: 'https://w3id.org/kim/hcrt/foo', label: 'Made-Up' }, // dropped
      { id: 'https://w3id.org/kim/hcrt/text', label: 'Arbeitsblatt' }, // swapped
      { id: `${EKW_LRT_ID_PREFIX}quelle`, label: 'Quelle' } // passthrough
    ]);
    expect(result.map((r) => r.label)).toEqual(['Arbeitsblatt', 'Quelle']);
    warnSpy.mockRestore();
  });
});
