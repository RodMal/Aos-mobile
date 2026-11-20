/**
 * The Venomites token of a Sunblood Pack (R12, owner 2026-11-19): set up next to the unit when it
 * is deployed, by its player (the NPC places its own). The token has no rules of its own beyond
 * being on the battlefield (Venomite Swarm; a roll of 1 removes it); where it stands is shown on
 * the board. Readings: docs/RULES-DECISIONS.md I104.
 */
import { footprintToPoint } from '../rules/core/objectives.js';
import { abilitiesOf } from './abilities/effects.js';
import { VENOMITE_SWARM_ID } from './abilities/seraphon.js';
import { illegal, type Ctx } from './ctx.js';
import { startRound } from './turns.js';
import { unitCentre, unitFootprints } from './query.js';
import type { Scenario, UnitState } from './types.js';

export const VENOMITE_SIDES = ['top', 'bottom', 'left', 'right'] as const;
export type VenomiteSide = (typeof VENOMITE_SIDES)[number];

/** Gap between the unit's bases and the token, in inches. */
const TOKEN_GAP = 0.5;

export const hasVenomites = (scenario: Scenario, unit: UnitState): boolean =>
  abilitiesOf(scenario, unit).some((a) => a.id === VENOMITE_SWARM_ID);

/** The point next to the unit on `side` (as seen on screen), just clear of its bases and on the table. */
export function venomitePoint(
  scenario: Scenario,
  unit: UnitState,
  side: VenomiteSide,
): { x: number; y: number } {
  const c = unitCentre(unit);
  const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
  const dy = side === 'top' ? -1 : side === 'bottom' ? 1 : 0;
  const fps = unitFootprints(scenario, unit);
  const { width, height } = scenario.battlefield;
  const clamp = (x: number, y: number) => ({
    x: Math.min(width - 1, Math.max(1, x)),
    y: Math.min(height - 1, Math.max(1, y)),
  });
  for (let r = 0.5; r <= 30; r += 0.5) {
    const p = clamp(c.x + dx * r, c.y + dy * r);
    if (fps.every((fp) => footprintToPoint(fp, p.x, p.y) >= TOKEN_GAP)) return p;
  }
  return clamp(c.x + dx * 30, c.y + dy * 30);
}

/** Where the token stands: the point its player chose, else just below the unit (a quick start). */
export function venomiteTokenAt(scenario: Scenario, unit: UnitState): { x: number; y: number } {
  return unit.venomitesAt ?? venomitePoint(scenario, unit, 'bottom');
}

/** After a unit is deployed: its player places its Venomites token. */
export function offerVenomiteToken(ctx: Ctx, unit: UnitState): void {
  if (!hasVenomites(ctx.scenario, unit) || unit.venomitesGone) return;
  ctx.s.stack.push({ t: 'venomites', player: unit.owner, unit: unit.id });
}

/** Answers the token placement: `value` is one of `VENOMITE_SIDES`. */
export function chooseVenomiteToken(ctx: Ctx, value: string): void {
  const { s } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (frame?.t !== 'venomites') illegal('There is no Venomites token to place.');
  if (!(VENOMITE_SIDES as readonly string[]).includes(value)) {
    illegal('Place the Venomites token on the top, bottom, left or right of the unit.');
  }
  const unit = s.units[frame.unit]!;
  s.stack.pop();
  unit.venomitesAt = venomitePoint(ctx.scenario, unit, value as VenomiteSide);
  ctx.events.push({
    t: 'note',
    text: `${unit.name}: the Venomites token is placed next to the unit.`,
  });
  // The last unit of the deployment may have been the one that held the battle back.
  if (s.stack.length === 0) startRound(ctx);
}
