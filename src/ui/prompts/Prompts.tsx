/** Prompt router: picks the component for the human's pending decision. */
import { useGameState, useHuman, useHumanDecision } from '../game/hooks.js';
import { AsterismPrompt } from './AsterismPrompt.js';
import { CreepingDreadPrompt } from './CreepingDreadPrompt.js';
import { FugitivePrompt } from './FugitivePrompt.js';
import { VengeancePrompt } from './VengeancePrompt.js';
import { PrayerPrompt } from './PrayerPrompt.js';
import { PainPrompt } from './PainPrompt.js';
import { PlaceOfPowerPrompt } from './PlaceOfPowerPrompt.js';
import { PriorityPrompt } from './PriorityPrompt.js';
import { RerollPrompt } from './RerollPrompt.js';
import { ReactionPrompt } from './ReactionPrompt.js';
import { SeasonPrompt } from './SeasonPrompt.js';

export { ConfirmDialog } from './ConfirmDialog.js';
export { Chooser } from './Chooser.js';
export { GameEnd } from './GameEnd.js';

export function DecisionPrompts() {
  const d = useHumanDecision();
  const state = useGameState();
  const human = useHuman();
  if (!d) return null;
  if (d.kind === 'priority') return <PriorityPrompt d={d} />;
  if (d.kind === 'fugitive') {
    return <FugitivePrompt key="fugitive" d={d} />;
  }
  if (d.kind === 'prayer') return <PrayerPrompt key={`${d.unit}:${d.points}`} d={d} />;
  if (d.kind === 'asterism') return <AsterismPrompt key={`${state.round}`} d={d} />;
  if (d.kind === 'vengeance') {
    return <VengeancePrompt key={`${d.stage}:${d.unit ?? ''}`} d={d} />;
  }
  if (d.kind === 'reaction') {
    const glamour = d.options.find((o) => o.ability === 'glamourweave');
    if (glamour?.reroll)
      return (
        <RerollPrompt
          key={`${d.trigger}:${glamour.reroll.die}:${glamour.reroll.weapon}`}
          option={glamour}
        />
      );
    const pain = d.options.find((o) => o.ability === 'fightThroughThePain');
    if (pain) {
      return (
        <PainPrompt key={d.trigger} option={pain} fury={state.players[human].furyLevel ?? 0} />
      );
    }
    return <ReactionPrompt key={d.trigger} d={d} />;
  }
  if (d.kind === 'placeOfPower') return <PlaceOfPowerPrompt d={d} />;
  if (d.kind === 'alarielleSeason') {
    return <SeasonPrompt key={state.round} d={d} />;
  }
  if (d.kind === 'creepingDread') {
    return <CreepingDreadPrompt key={state.round * 10 + state.turnIndex} d={d} />;
  }
  return null;
}
