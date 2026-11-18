/**
 * Vengeance of Azyr (7c7e-3757-9881-5bd7, Sunclaw Starhost): at the end of any turn, once per
 * turn for the army, up to 3 friendly Saurus or Kroxigor units in combat each make a pile-in
 * move, then pick an enemy unit in combat with them and roll a D3: on a 2+ that unit takes that
 * much mortal damage. The frames are described on `Frame` (`vengeance`); readings in
 * docs/RULES-DECISIONS.md (I85 to I87).
 */
import { VENGEANCE_MAX, vengeanceCandidates, vengeanceFoes } from '../rules/factions/kroak.js';
import { illegal, rollD3, type Ctx } from './ctx.js';
import { inflictMortalDamage } from './damage.js';
import { PILE_IN_DISTANCE } from './movement.js';
import type { Action, Frame, UnitId } from './types.js';

/** The start of a pick: `vengeance:<id>,<id>`. */
export const VENGEANCE_PICK = 'vengeance:';

type VengeanceFrame = Extract<Frame, { t: 'vengeance' }>;

/** The answer to a `vengeance` decision: `choose` with `vengeance:` and up to 3 unit IDs, or `none`; or the enemy's ID. */
export function chooseVengeance(ctx: Ctx, action: Action): void {
  const { s, scenario } = ctx;
  const frame = s.stack[s.stack.length - 1];
  if (frame?.t !== 'vengeance') illegal('There is no Vengeance of Azyr to use.');
  if (action.t !== 'choose') illegal('Pick units for Vengeance of Azyr, or choose none.');
  if (frame.stage === 'pick') {
    // The prefix keeps a unit ID from another question's answer (a saved game's Creeping Dread
    // pick, say) from being taken for this one.
    if (action.value !== 'none' && !action.value.startsWith(VENGEANCE_PICK)) {
      illegal('Pick units for Vengeance of Azyr, or choose none.');
    }
    const picked =
      action.value === 'none'
        ? []
        : [
            ...new Set(
              action.value
                .slice(VENGEANCE_PICK.length)
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            ),
          ];
    const allowed = vengeanceCandidates(scenario, s, frame.player).map((u) => u.id);
    if (action.value !== 'none' && (picked.length < 1 || picked.length > VENGEANCE_MAX)) {
      illegal(`Pick 1 to ${VENGEANCE_MAX} units for Vengeance of Azyr, or choose none.`);
    }
    if (picked.some((id) => !allowed.includes(id))) {
      illegal('Vengeance of Azyr picks friendly Saurus or Kroxigor units that are in combat.');
    }
    s.stack.pop();
    if (picked.length === 0) return;
    ctx.events.push({
      t: 'note',
      text: `Vengeance of Azyr: ${picked.map((id) => s.units[id]!.name).join(', ')}.`,
    });
    s.stack.push({ t: 'vengeance', player: frame.player, stage: 'pile', queue: picked });
    return;
  }
  // The enemy unit to strike, for the unit at the head of the queue.
  const unit = s.units[frame.queue[0]!]!;
  const foes = vengeanceFoes(scenario, s, unit).map((u) => u.id);
  if (!foes.includes(action.value)) illegal('Pick an enemy unit in combat with the unit.');
  strike(ctx, frame, action.value);
}

/** The D3 for the head of the queue against `enemy`; then on to the next unit. */
function strike(ctx: Ctx, frame: VengeanceFrame, enemy: UnitId): void {
  const { s } = ctx;
  const unit = s.units[frame.queue[0]!]!;
  const roll = rollD3(ctx, unit.owner, 'Vengeance of Azyr');
  if (roll >= 2) inflictMortalDamage(ctx, s.units[enemy]!, roll, 'Vengeance of Azyr');
  frame.queue = frame.queue.slice(1);
  frame.stage = 'pile';
}

/**
 * Moves a `pile` or `strike` frame on without an answer where it can: pushes the pile-in, finds
 * the one enemy to strike. Returns false when it waits for the player (several enemies).
 */
export function advanceVengeance(ctx: Ctx, frame: VengeanceFrame): boolean {
  const { s, scenario } = ctx;
  const id = frame.queue[0];
  if (id === undefined) {
    s.stack.pop();
    return true;
  }
  const unit = s.units[id]!;
  if (unit.status !== 'battlefield') {
    frame.queue = frame.queue.slice(1);
    frame.stage = 'pile';
    return true;
  }
  if (frame.stage === 'pile') {
    frame.stage = 'strike';
    s.stack.push({ t: 'place', unit: id, reason: 'pileIn', allowance: PILE_IN_DISTANCE, dice: [] });
    return true;
  }
  const foes = vengeanceFoes(scenario, s, unit);
  if (foes.length === 0) {
    frame.queue = frame.queue.slice(1);
    frame.stage = 'pile';
    return true;
  }
  if (foes.length > 1) return false;
  strike(ctx, frame, foes[0]!.id);
  return true;
}
