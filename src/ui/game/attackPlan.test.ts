import { describe, expect, it } from 'vitest';
import type { WeaponTargets } from '../../engine/index.js';
import {
  assignAll,
  bestPlan,
  emptyPlan,
  planDamage,
  setWeaponTarget,
  targetSummary,
  toAllocations,
} from './attackPlan.js';

const options: WeaponTargets[] = [
  {
    weaponId: 'bow',
    weaponName: 'Bow',
    targets: [
      { unit: 'x', modelsInRange: 3, expectedDamage: 2 },
      { unit: 'y', modelsInRange: 3, expectedDamage: 1 },
    ],
  },
  {
    weaponId: 'spear',
    weaponName: 'Spear',
    targets: [{ unit: 'y', modelsInRange: 2, expectedDamage: 4 }],
  },
];

describe('attack plans', () => {
  it('starts empty and allocates nothing', () => {
    expect(toAllocations(emptyPlan(options))).toEqual([]);
  });

  it('assigns every weapon that can reach a tapped target', () => {
    const plan = assignAll(emptyPlan(options), options, 'y');
    expect(toAllocations(plan)).toEqual([
      { weaponId: 'bow', target: 'y' },
      { weaponId: 'spear', target: 'y' },
    ]);
    const x = assignAll(plan, options, 'x');
    expect(x).toEqual({ bow: 'x', spear: 'y' });
  });

  it('changes and clears a single weapon’s target', () => {
    const plan = setWeaponTarget(assignAll(emptyPlan(options), options, 'y'), 'bow', null);
    expect(toAllocations(plan)).toEqual([{ weaponId: 'spear', target: 'y' }]);
  });

  it('picks the best target per weapon and sums expected damage', () => {
    const plan = bestPlan(options);
    expect(plan).toEqual({ bow: 'x', spear: 'y' });
    expect(planDamage(plan, options)).toEqual(
      new Map([
        ['x', 2],
        ['y', 4],
      ]),
    );
    expect(targetSummary(options).get('y')).toBe(5);
  });
});
