import { applyMortalDamage, healUnit } from '../damage.js';
import { d6s, rollD3 } from '../ctx.js';
import {
  aliveCount,
  hasKeyword,
  inCreepingOvergrowth,
  unitCentre,
  unitsOf,
  unitsWithin,
} from '../query.js';
import { addEffect, legalTargetsForSpec, registerAbility } from './effects.js';
import type { AbilityDefinition, AbilityTargetSpec } from './types.js';
import type { Scenario, GameState, UnitState } from '../types.js';

function pickUpToThreeTargets(
  scenario: Scenario,
  state: GameState,
  caster: UnitState,
  spec: AbilityTargetSpec,
  primary?: UnitState,
  secondary?: UnitState,
): UnitState[] {
  const legal = legalTargetsForSpec(scenario, state, caster, spec);
  const picked: UnitState[] = [];
  if (primary && legal.some((u) => u.id === primary.id)) picked.push(primary);
  if (
    secondary &&
    legal.some((u) => u.id === secondary.id) &&
    !picked.some((u) => u.id === secondary.id)
  ) {
    picked.push(secondary);
  }
  const c = unitCentre(caster);
  const rest = legal
    .filter((u) => !picked.some((p) => p.id === u.id))
    .sort((a, b) => {
      const ca = unitCentre(a);
      const cb = unitCentre(b);
      return Math.hypot(ca.x - c.x, ca.y - c.y) - Math.hypot(cb.x - c.x, cb.y - c.y);
    });
  for (const u of rest) {
    if (picked.length >= 3) break;
    picked.push(u);
  }
  return picked;
}

export const LORE_ABILITIES: AbilityDefinition[] = [
  // ─── Lore of the Deepwood (Sylvaneth Spells) ────────────────────────────────
  {
    id: '97df-e136-9fb4-5aca',
    name: 'Jade Thorns',
    kind: 'spell',
    bsdata: true,
    castingValue: 6,
    unlimited: true,
    target: {
      side: 'friendly',
      range: 12,
      whollyWithin: true,
      keywords: ['SYLVANETH'],
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: '97df-e136-9fb4-5aca',
        name: 'Jade Thorns',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'turn',
      });
    },
    effectModifiers: (eff, sit) => {
      if (eff.targetUnit !== sit.attacker.id || sit.mode !== 'fight') return [];
      return [{ stat: 'wound', value: 1, source: 'Jade Thorns', appliesToCompanion: true }];
    },
  },
  {
    id: '4ea1-b08a-3684-8d35',
    name: 'Zephyrspite Rush',
    kind: 'spell',
    bsdata: true,
    castingValue: 6,
    target: {
      side: 'friendly',
      range: 12,
      whollyWithin: true,
      keywords: ['SYLVANETH'],
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: '4ea1-b08a-3684-8d35',
        name: 'Zephyrspite Rush',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'turn',
      });
    },
    effectGrants: () => ({ runAndCharge: true }),
  },
  {
    id: '77cf-59bd-fc8e-f6c7',
    name: 'Grasping Roots',
    kind: 'spell',
    bsdata: true,
    castingValue: 5,
    target: {
      side: 'enemy',
      range: 18,
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: '77cf-59bd-fc8e-f6c7',
        name: 'Grasping Roots',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'startOfNextTurn',
      });
    },
    effectGrants: () => ({ cannotRun: true, chargeRollModifier: -1 }),
  },

  // ─── Lore of the Spirit-Song (Sylvaneth Prayers) ────────────────────────────
  {
    id: 'a865-102f-ce95-480c',
    name: 'Song Of The Lost',
    kind: 'prayer',
    bsdata: true,
    chantingValue: 4,
    highChantThreshold: 8,
    unlimited: true,
    target: {
      side: 'friendly',
      range: 12,
      whollyWithin: true,
      keywords: ['SYLVANETH'],
      allowCreepingOvergrowth: true,
    },
    resolve: ({ ctx, unit, target, roll, choice }) => {
      if (!target) return;
      const high = (roll ?? 0) >= 8;
      const isMonster = hasKeyword(ctx.scenario, target, 'MONSTER');
      const useIgnoreSaveMods =
        high && (choice === 'ignoreSaveMods' || (!choice && target.damage === 0 && !isMonster));
      addEffect(ctx.s, {
        id: 'a865-102f-ce95-480c',
        name: 'Song Of The Lost',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'startOfNextTurn',
        data: { ignoreSaveModifiers: useIgnoreSaveMods },
      });
      if (high) {
        const useHeal =
          choice === 'heal' || (choice !== 'ignoreSaveMods' && (target.damage > 0 || isMonster));
        if (useHeal) {
          healUnit(ctx, target, 3, 'Song Of The Lost');
        }
      }
    },
    effectModifiers: (eff, sit) => {
      if (eff.targetUnit !== sit.target.id) return [];
      return [{ stat: 'wound', value: -1, source: 'Song Of The Lost' }];
    },
    effectGrants: (eff, u, scenario) =>
      eff.data?.ignoreSaveModifiers && !hasKeyword(scenario, u, 'MONSTER')
        ? { ignoreSaveModifiers: true }
        : {},
  },
  {
    id: '4c37-4bd5-f9d5-170a',
    name: 'Song Of Dread',
    kind: 'prayer',
    bsdata: true,
    chantingValue: 4,
    highChantThreshold: 8,
    target: {
      side: 'enemy',
      range: 18,
      allowCreepingOvergrowth: true,
    },
    resolve: ({ ctx, unit, target, secondTarget, roll }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: '4c37-4bd5-f9d5-170a',
        name: 'Song Of Dread',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'startOfNextTurn',
      });
      if ((roll ?? 0) >= 8 && secondTarget && secondTarget.id !== target.id) {
        addEffect(ctx.s, {
          id: '4c37-4bd5-f9d5-170a',
          name: 'Song Of Dread',
          sourceUnit: unit.id,
          targetUnit: secondTarget.id,
          owner: unit.owner,
          expires: 'startOfNextTurn',
        });
      }
    },
    triggerWindow: 'afterMove',
    onTrigger: (eff, ctx, payload) => {
      if (
        !payload.unit ||
        payload.unit.id !== eff.targetUnit ||
        payload.unit.status !== 'battlefield'
      ) {
        return;
      }
      if (inCreepingOvergrowth(ctx.scenario, ctx.s, payload.unit, eff.owner, false)) {
        const d3 = rollD3(ctx, eff.owner, 'Song Of Dread damage');
        applyMortalDamage(ctx, payload.unit, d3, 'Song Of Dread');
      }
    },
  },
  {
    id: '1b5b-a2e8-6dd3-17fb',
    name: 'Song Of War',
    kind: 'prayer',
    bsdata: true,
    chantingValue: 5,
    highChantThreshold: 10,
    target: {
      side: 'friendly',
      range: 12,
      whollyWithin: true,
      keywords: ['SYLVANETH'],
      allowCreepingOvergrowth: true,
    },
    resolve: ({ ctx, unit, target, secondTarget, roll }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: '1b5b-a2e8-6dd3-17fb',
        name: 'Song Of War',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'startOfNextTurn',
      });
      if ((roll ?? 0) >= 10 && secondTarget && secondTarget.id !== target.id) {
        addEffect(ctx.s, {
          id: '1b5b-a2e8-6dd3-17fb',
          name: 'Song Of War',
          sourceUnit: unit.id,
          targetUnit: secondTarget.id,
          owner: unit.owner,
          expires: 'startOfNextTurn',
        });
      }
    },
    effectModifiers: (eff, sit) => {
      if (eff.targetUnit !== sit.attacker.id || sit.mode !== 'fight') return [];
      return [{ stat: 'rend', value: 1, source: 'Song Of War' }];
    },
  },

  // ─── Lore of Celestial Manipulation (Seraphon Spells) ───────────────────────
  {
    id: '78d-5a7e-a6c9-7674',
    name: "Comet's Call",
    kind: 'spell',
    bsdata: true,
    castingValue: 7,
    target: {
      side: 'enemy',
      range: 18,
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      const n = aliveCount(target);
      if (n <= 0) return;
      const dice = d6s(ctx, n);
      ctx.events.push({
        t: 'roll',
        player: unit.owner,
        label: "Comet's Call",
        dice,
      });
      const mortal = dice.filter((d) => d >= 5).length;
      if (mortal > 0) {
        applyMortalDamage(ctx, target, mortal, "Comet's Call");
      }
    },
  },
  {
    id: 'e0c2-6f59-3b19-9e51',
    name: 'Mystical Unforging',
    kind: 'spell',
    bsdata: true,
    castingValue: 6,
    unlimited: true,
    target: {
      side: 'enemy',
      range: 12,
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: 'e0c2-6f59-3b19-9e51',
        name: 'Mystical Unforging',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'startOfNextTurn',
      });
    },
    effectModifiers: (eff, sit) => {
      if (eff.targetUnit !== sit.attacker.id) return [];
      return [{ stat: 'rend', value: -1, source: 'Mystical Unforging' }];
    },
  },
  {
    id: '6086-ce9b-38be-28b2',
    name: 'Speed of Huanchi',
    kind: 'spell',
    bsdata: true,
    castingValue: 6,
    target: {
      side: 'friendly',
      range: 12,
      whollyWithin: true,
      keywords: ['SERAPHON'],
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: '6086-ce9b-38be-28b2',
        name: 'Speed of Huanchi',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'startOfNextTurn',
      });
    },
    effectGrants: () => ({ runAndShoot: true, runAndCharge: true }),
  },

  // ─── Aetherwrought Machineries (Manifestation Summons) ──────────────────────
  {
    id: '678b-96e1-66bb-1de8',
    name: 'Summon Aethervoid Pendulum',
    kind: 'summon',
    bsdata: true,
    castingValue: 6,
    summonWarscrollId: 'fcb6-ae80-2e58-aadb',
    summonRange: 12,
    summonMinEnemyGap: 9,
  },
  {
    id: 'c402-d205-c59f-e84b',
    name: 'Summon Chronomantic Cogs',
    kind: 'summon',
    bsdata: true,
    castingValue: 6,
    summonWarscrollId: '1aba-bc38-e988-d79f',
    summonRange: 12,
    summonMinEnemyGap: 0,
  },
  {
    id: 'd4da-e543-192d-84ae',
    name: 'Summon Quicksilver Swords',
    kind: 'summon',
    bsdata: true,
    castingValue: 6,
    summonWarscrollId: '8cde-fafe-2b2a-ced5',
    summonRange: 12,
    summonMinEnemyGap: 9,
  },

  // ─── Morbid Conjuration (Manifestation Summons) ─────────────────────────────
  {
    id: '1b29-60f4-48d2-a6bb',
    name: 'Summon Purple Sun of Shyish',
    kind: 'summon',
    bsdata: true,
    castingValue: 8,
    summonWarscrollId: 'e7a5-e611-4c13-22d0',
    summonRange: 12,
    summonMinEnemyGap: 9,
  },
  {
    id: '1f2c-ca29-2c5b-24ba',
    name: 'Summon Malevolent Maelstrom',
    kind: 'summon',
    bsdata: true,
    castingValue: 6,
    summonWarscrollId: 'e699-49b7-d2b8-d5fc',
    summonRange: 12,
    summonMinEnemyGap: 9,
  },
  {
    id: 'ee70-f212-c079-a752',
    name: 'Summon Soulsnare Shackles',
    kind: 'summon',
    bsdata: true,
    castingValue: 6,
    summonWarscrollId: 'dee3-92a0-27e7-252a',
    summonRange: 18,
    summonMinEnemyGap: 0,
  },
  {
    id: '36e0-4b94-aeb-67ac',
    name: 'Summon Suffocating Gravetide',
    kind: 'summon',
    bsdata: true,
    castingValue: 8,
    summonWarscrollId: '1885-a1aa-bf5d-6d0d',
    summonRange: 12,
    summonMinEnemyGap: 9,
  },

  // ─── Warscroll Spells (Sylvaneth & Seraphon Wizards) ────────────────────────
  {
    id: 'b4bf-ef71-9dfe-e837',
    name: 'Metamorphosis',
    kind: 'spell',
    bsdata: true,
    castingValue: 7,
    target: {
      side: 'enemy',
      range: 12,
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      const tc = unitCentre(target);
      const nearbyEnemies = unitsOf(ctx.s, target.owner).filter(
        (e) => e.id !== target.id && unitsWithin(ctx.scenario, target, e, 6),
      );
      const dice = d6s(ctx, 2);
      const dmg = Math.ceil(dice[0]! / 2) + Math.ceil(dice[1]! / 2);
      ctx.events.push({
        t: 'roll',
        player: unit.owner,
        label: 'Metamorphosis damage',
        dice,
      });
      const res = applyMortalDamage(ctx, target, dmg, 'Metamorphosis');
      if (!res.destroyed) return;

      const overgrown = ctx.s.overgrownTerrain ?? [];
      const availableTerrain = ctx.scenario.battlefield.terrain.filter(
        (t) => !overgrown.includes(t.id),
      );
      if (availableTerrain.length > 0) {
        const distToTerrain = (poly: readonly (readonly [number, number])[]): number => {
          let best = Infinity;
          for (const [vx, vy] of poly) {
            best = Math.min(best, Math.hypot(vx - tc.x, vy - tc.y));
          }
          return best;
        };
        const closest = [...availableTerrain].sort(
          (a, b) => distToTerrain(a.polygon) - distToTerrain(b.polygon),
        )[0]!;
        ctx.s.overgrownTerrain = [...overgrown, closest.id];
        ctx.events.push({
          t: 'note',
          text: `${closest.name} gained an overgrown token from Metamorphosis.`,
        });
      } else {
        for (const enemy of nearbyEnemies) {
          if (enemy.status !== 'battlefield') continue;
          const splash = rollD3(ctx, unit.owner, 'Metamorphosis splash damage');
          applyMortalDamage(ctx, enemy, splash, 'Metamorphosis');
        }
      }
    },
  },
  {
    id: 'a924-fd6e-9278-4d4c',
    name: 'Enrage The Spites',
    kind: 'spell',
    bsdata: true,
    castingValue: 7,
    target: {
      side: 'enemy',
      range: 12,
      allowCreepingOvergrowth: true,
    },
    resolve: ({ ctx, unit, target, secondTarget }) => {
      const targets = pickUpToThreeTargets(
        ctx.scenario,
        ctx.s,
        unit,
        { side: 'enemy', range: 12, allowCreepingOvergrowth: true },
        target,
        secondTarget,
      );
      for (const tgt of targets) {
        if (tgt.status !== 'battlefield') continue;
        const dmg = rollD3(ctx, unit.owner, 'Enrage The Spites damage');
        applyMortalDamage(ctx, tgt, dmg, 'Enrage The Spites');
      }
    },
  },
  {
    id: 'f7bf-5a9-2828-a74',
    name: 'Celestial Deliverance',
    kind: 'spell',
    bsdata: true,
    castingValue: 7,
    repeatSameUnit: true,
    target: {
      side: 'enemy',
      range: 18,
    },
    resolve: ({ ctx, unit, target, secondTarget }) => {
      const targets = pickUpToThreeTargets(
        ctx.scenario,
        ctx.s,
        unit,
        { side: 'enemy', range: 18 },
        target,
        secondTarget,
      );
      for (const tgt of targets) {
        if (tgt.status !== 'battlefield') continue;
        const dmg = rollD3(ctx, unit.owner, 'Celestial Deliverance damage');
        applyMortalDamage(ctx, tgt, dmg, 'Celestial Deliverance');
      }
    },
  },
  {
    id: '2209-9b15-d3f-15ed',
    name: 'Celestial Doom',
    kind: 'spell',
    bsdata: true,
    castingValue: 7,
    target: {
      side: 'enemy',
      range: 18,
    },
    resolve: ({ ctx, unit, target }) => {
      if (!target) return;
      addEffect(ctx.s, {
        id: '2209-9b15-d3f-15ed',
        name: 'Celestial Doom',
        sourceUnit: unit.id,
        targetUnit: target.id,
        owner: unit.owner,
        expires: 'turn',
      });
    },
    effectGrants: () => ({ disableWard: true }),
  },
];

for (const def of LORE_ABILITIES) {
  registerAbility(def);
}
