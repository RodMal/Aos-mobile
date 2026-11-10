/**
 * Attack modifiers, evaluated with the attack in context. Every source of a hit, wound,
 * save, rend or damage modifier reports here as a `Modifier`; `sumModifiers` applies the
 * Companion rule and the caps. Faction abilities (M3/M4) add their own sources to
 * `attackModifiers`.
 */
import type { Weapon } from '../../data/profile.js';
import type { AttackMods } from '../../engine/expected.js';
import { hasKeyword } from '../../engine/query.js';
import type { AttackMode, GameState, Scenario, UnitState } from '../../engine/types.js';

export type ModifierStat = 'hit' | 'wound' | 'save' | 'rend' | 'damage';

export interface Modifier {
  stat: ModifierStat;
  value: number;
  /** Shown in logs and tooltips. */
  source: string;
  /**
   * A positive hit, wound or characteristic modifier from a friendly ability is ignored by
   * Companion weapons. Set this when the modifier applies to them anyway (All-out Attack
   * names itself as the exception; a weapon's own abilities always apply).
   */
  appliesToCompanion?: boolean;
}

export interface AttackSituation {
  attacker: UnitState;
  target: UnitState;
  weapon: Weapon;
  mode: AttackMode;
  /** The attacking unit used All-out Attack for this attack. */
  allOutAttack?: boolean;
  /** The target used All-out Defence against this attack. */
  allOutDefence?: boolean;
}

/** Rend from Anti-X abilities that apply to this target; several are cumulative. */
export function antiRend(scenario: Scenario, weapon: Weapon, target: UnitState): number {
  let rend = 0;
  for (const a of weapon.abilities) {
    if (a.t !== 'anti') continue;
    const applies =
      a.keyword === 'CHARGE' ? target.charged : hasKeyword(scenario, target, a.keyword);
    if (applies) rend += a.rend;
  }
  return rend;
}

/** Damage from Charge (+n Damage) when the attacking unit charged this turn. */
export function chargeDamage(weapon: Weapon, attacker: UnitState): number {
  let dmg = 0;
  for (const a of weapon.abilities) if (a.t === 'chargeDamage' && attacker.charged) dmg += a.value;
  return dmg;
}

/** Every modifier that applies to this attack. Today: weapon abilities and commands. */
export function attackModifiers(
  scenario: Scenario,
  _state: GameState,
  a: AttackSituation,
): Modifier[] {
  const out: Modifier[] = [];
  const anti = antiRend(scenario, a.weapon, a.target);
  if (anti) out.push({ stat: 'rend', value: anti, source: 'Anti-X', appliesToCompanion: true });
  const charge = chargeDamage(a.weapon, a.attacker);
  if (charge) {
    out.push({ stat: 'damage', value: charge, source: 'Charge', appliesToCompanion: true });
  }
  if (a.allOutAttack) {
    out.push({ stat: 'hit', value: 1, source: 'All-out Attack', appliesToCompanion: true });
  }
  if (a.allOutDefence) out.push({ stat: 'save', value: 1, source: 'All-out Defence' });
  if (a.target.allOutAttack) {
    out.push({ stat: 'save', value: -1, source: 'All-out Attack (this turn)' });
  }
  return out;
}

/**
 * Totals modifiers for one weapon. Companion weapons drop positive hit, wound, rend and
 * damage modifiers unless marked `appliesToCompanion`. Hit and wound are capped at +1/-1,
 * save at +1; rend and damage are not capped.
 */
export function sumModifiers(mods: readonly Modifier[], weapon: Weapon): AttackMods {
  const companion = weapon.abilities.some((x) => x.t === 'companion');
  const total = { hit: 0, wound: 0, save: 0, rend: 0, damage: 0 };
  for (const m of mods) {
    if (companion && m.stat !== 'save' && m.value > 0 && !m.appliesToCompanion) continue;
    total[m.stat] += m.value;
  }
  return {
    hit: Math.max(-1, Math.min(1, total.hit)),
    wound: Math.max(-1, Math.min(1, total.wound)),
    save: Math.min(1, total.save),
    rend: total.rend,
    damage: total.damage,
  };
}
