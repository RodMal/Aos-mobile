/**
 * Objective control (GHB 2026-27 Core Rules 32.0). A model contests an objective when its
 * base is within the objective's `radius` of the centre (I1 in docs/RULES-DECISIONS.md),
 * and contests only the nearest one. A player's control score is the sum of the Control
 * characteristic of their contesting models; a higher score takes control, which is kept
 * until the opponent takes it. Ported from aos-webapp `rules/objectives.ts`.
 */
import type { ObjectiveSpec } from '../../data/battlefield.js';
import { footprintGap, type Footprint } from '../../geom/index.js';
import { DIST_EPS, modelFootprint, profileOf } from '../../engine/query.js';
import type { GameState, PlayerId, Scenario, UnitState } from '../../engine/types.js';
import { battleplanRules } from '../battleplans/index.js';

/** Edge-of-base distance from a footprint to a point. */
export function footprintToPoint(fp: Footprint, x: number, y: number): number {
  if (fp.kind === 'circle') return Math.max(0, Math.hypot(fp.cx - x, fp.cy - y) - fp.r);
  return footprintGap(fp, { kind: 'circle', cx: x, cy: y, r: 0 });
}

/** The objective model `i` of `unit` contests, or null. */
export function contestedObjective(
  scenario: Scenario,
  unit: UnitState,
  i: number,
): ObjectiveSpec | null {
  const fp = modelFootprint(scenario, unit, i);
  let best: ObjectiveSpec | null = null;
  let bestDist = Infinity;
  for (const o of scenario.battlefield.objectives) {
    const d = footprintToPoint(fp, o.x, o.y);
    if (d <= o.radius + DIST_EPS && d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best;
}

/** Control scores per objective id: [player 0, player 1]. */
export function controlScores(scenario: Scenario, state: GameState): Map<string, [number, number]> {
  const scores = new Map<string, [number, number]>();
  for (const o of scenario.battlefield.objectives) scores.set(o.id, [0, 0]);
  const bp = battleplanRules(scenario.battlefield.id);
  for (const id of state.unitOrder) {
    const unit = state.units[id]!;
    if (unit.status !== 'battlefield') continue;
    const profile = profileOf(scenario, unit);
    if (profile.control <= 0 || profile.isFactionTerrain || profile.isManifestation) continue;
    const contestingObjectives = new Set<string>();
    unit.models.forEach((m, i) => {
      if (!m.alive) return;
      const o = contestedObjective(scenario, unit, i);
      if (o) {
        contestingObjectives.add(o.id);
        scores.get(o.id)![unit.owner] += profile.control;
      }
    });
    if (bp.controlBonus && contestingObjectives.size > 0) {
      for (const objId of contestingObjectives) {
        const obj = scenario.battlefield.objectives.find((o) => o.id === objId)!;
        const bonus = bp.controlBonus(scenario, state, unit, obj);
        if (bonus > 0) {
          scores.get(objId)![unit.owner] += bonus;
        }
      }
    }
  }
  return scores;
}

/** Objectives whose controller changes now, with the new controller. Does not mutate. */
export function resolveControl(
  scenario: Scenario,
  state: GameState,
): { id: string; controller: PlayerId | null }[] {
  const scores = controlScores(scenario, state);
  const changes: { id: string; controller: PlayerId | null }[] = [];
  for (const o of state.objectives) {
    const [a, b] = scores.get(o.id) ?? [0, 0];
    const next: PlayerId | null = a > b ? 0 : b > a ? 1 : o.controller;
    if (next !== o.controller) changes.push({ id: o.id, controller: next });
  }
  return changes;
}

export function controlledCount(state: GameState, player: PlayerId): number {
  return state.objectives.filter((o) => o.controller === player).length;
}
