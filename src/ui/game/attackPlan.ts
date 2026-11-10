/** Assigning weapons to targets for shooting and fighting. Pure. */
import type { Allocation, UnitId, WeaponTargets } from '../../engine/index.js';

/** Target per weapon id; null leaves the weapon unused. */
export type AttackPlan = Record<string, UnitId | null>;

export function emptyPlan(options: readonly WeaponTargets[]): AttackPlan {
  return Object.fromEntries(options.map((o) => [o.weaponId, null]));
}

/** A plan that points every weapon at its best target by expected damage. */
export function bestPlan(options: readonly WeaponTargets[]): AttackPlan {
  const plan = emptyPlan(options);
  for (const o of options) {
    let best: { unit: UnitId; dmg: number } | null = null;
    for (const t of o.targets)
      if (!best || t.expectedDamage > best.dmg) best = { unit: t.unit, dmg: t.expectedDamage };
    plan[o.weaponId] = best?.unit ?? null;
  }
  return plan;
}

/** Points every weapon that can reach `target` at it; other weapons keep their target. */
export function assignAll(
  plan: AttackPlan,
  options: readonly WeaponTargets[],
  target: UnitId,
): AttackPlan {
  const next = { ...plan };
  for (const o of options) if (o.targets.some((t) => t.unit === target)) next[o.weaponId] = target;
  return next;
}

export function setWeaponTarget(
  plan: AttackPlan,
  weaponId: string,
  target: UnitId | null,
): AttackPlan {
  return { ...plan, [weaponId]: target };
}

export function toAllocations(plan: AttackPlan): Allocation[] {
  return Object.entries(plan).flatMap(([weaponId, target]) =>
    target ? [{ weaponId, target }] : [],
  );
}

/** Every unit some weapon can target, with the expected damage if all weapons that can, do. */
export function targetSummary(options: readonly WeaponTargets[]): Map<UnitId, number> {
  const out = new Map<UnitId, number>();
  for (const o of options)
    for (const t of o.targets) out.set(t.unit, (out.get(t.unit) ?? 0) + t.expectedDamage);
  return out;
}

/** Expected damage of the plan per target. */
export function planDamage(
  plan: AttackPlan,
  options: readonly WeaponTargets[],
): Map<UnitId, number> {
  const out = new Map<UnitId, number>();
  for (const o of options) {
    const target = plan[o.weaponId];
    if (!target) continue;
    const t = o.targets.find((x) => x.unit === target);
    if (t) out.set(target, (out.get(target) ?? 0) + t.expectedDamage);
  }
  return out;
}
