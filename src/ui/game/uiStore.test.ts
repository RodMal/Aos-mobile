import { describe, expect, it } from 'vitest';
import { canAddAbilityTarget, toggleAbilityTarget, type AbilityPick } from './uiStore.js';

const pick = (targets: string[], parts: string[][]): AbilityPick => ({
  unit: 'm',
  target: null,
  targets,
  option: {
    t: 'ability',
    abilityId: 'x',
    name: 'Bound for the Great Oubliette',
    kind: 'activated',
    targets: ['a', 'b', 'c'],
    maxTargets: 2,
    partTargets: parts,
  },
});

describe('Oubliette pick: each target needs a part of its own within 3"', () => {
  // Part 1 reaches a and b, part 2 only a, part 3 nobody.
  const parts = [['a', 'b'], ['a'], []];
  it('allows a and b (b by part 1, a by part 2) and refuses c', () => {
    expect(canAddAbilityTarget(pick(['a'], parts), 'b')).toBe(true);
    expect(toggleAbilityTarget(pick(['a'], parts), 'b').targets).toEqual(['a', 'b']);
    expect(canAddAbilityTarget(pick([], parts), 'c')).toBe(false);
    expect(toggleAbilityTarget(pick([], parts), 'c').targets).toEqual([]);
  });
  it('refuses two units that only one part reaches', () => {
    const one = [['a', 'b'], [], []];
    expect(canAddAbilityTarget(pick(['a'], one), 'b')).toBe(false);
    expect(toggleAbilityTarget(pick(['a'], one), 'b').targets).toEqual(['a']);
  });
});
