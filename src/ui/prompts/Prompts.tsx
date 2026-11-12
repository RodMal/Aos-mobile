/** Modal prompts: priority, reactions, confirmations, the unit chooser and the result screen. */
import { useState, type ReactNode } from 'react';
import type { Decision, ReactionOption } from '../../engine/index.js';
import { dispatch } from '../game/actions.js';
import { COMMAND_NAMES, reactionText } from '../game/eventText.js';
import { logContext, playerName } from '../game/engine.js';
import { useGame } from '../game/instance.js';
import { useGameState, useHuman, useHumanDecision } from '../game/hooks.js';
import { randomSeed } from '../game/store.js';
import { useUi } from '../game/uiStore.js';

function Modal({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scrim" />
      <section className="modal" data-testid={testId}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

function Die({ value }: { value: number }) {
  return (
    <span className="die" aria-label={`rolled ${value}`}>
      {value}
    </span>
  );
}

/** Fight Through the Pain: the incoming damage, how many rage dice to spend, or take it all. */
function PainPrompt({ option, fury }: { option: ReactionOption; fury: number }) {
  const state = useGameState();
  const max = option.maxRageDice ?? 0;
  const damage = option.damage ?? 0;
  const [dice, setDice] = useState(Math.min(max, damage));
  const name = state.units[option.unit]?.name ?? option.unit;
  return (
    <Modal title="Fight Through the Pain" testId="reaction">
      <p data-testid="pain-damage">
        <strong>{name}</strong> is about to take <strong>{damage} damage</strong>.
      </p>
      <p className="muted small">
        Each rage die spent lowers your fury level by 1 (now {fury}) and removes 1 damage on a 3+.
      </p>
      <div className="stepper" role="group" aria-label="Rage dice">
        <span className="stepper-label">Rage dice</span>
        <button
          className="btn"
          aria-label="Fewer rage dice"
          disabled={dice <= 1}
          onClick={() => setDice(dice - 1)}
        >
          −
        </button>
        <span className="stepper-value" data-testid="pain-dice">
          {dice}
        </span>
        <button
          className="btn"
          aria-label="More rage dice"
          disabled={dice >= max}
          onClick={() => setDice(dice + 1)}
        >
          +
        </button>
        <span className="muted small">of {max}</span>
      </div>
      <div className="stack">
        <button
          className="btn wide"
          data-testid="pain-spend"
          onClick={() =>
            dispatch({
              t: 'ability',
              unit: option.unit,
              abilityId: 'fight-through-the-pain',
              rageDice: dice,
            })
          }
        >
          Spend {dice} rage {dice === 1 ? 'die' : 'dice'}
        </button>
        <button
          className="btn primary wide"
          data-testid="pain-skip"
          onClick={() => dispatch({ t: 'pass' })}
        >
          Take the damage
        </button>
      </div>
    </Modal>
  );
}

const SEASONS = [
  {
    id: 'burgeoning',
    name: 'The Burgeoning',
    text: 'Ever Growing may target any terrain feature the opponent does not control',
  },
  {
    id: 'reaping',
    name: 'The Reaping',
    text: '+1 to cast and chant wholly within 12" of Alarielle',
  },
  {
    id: 'dwindling',
    name: 'The Dwindling',
    text: 'Charge after retreating; no retreat mortal damage',
  },
  { id: 'everdusk', name: 'Everdusk', text: 'Creeping Dread can pick up to 3 enemy units' },
] as const;

/** Creeping Dread: tick up to `max` enemy units in the overgrowth, then use it or pass. */
function CreepingDreadPrompt({ d }: { d: Extract<Decision, { kind: 'creepingDread' }> }) {
  const state = useGameState();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < d.max ? [...p, id] : p,
    );
  return (
    <Modal title="Creeping Dread" testId="creeping-dread">
      <p>
        Pick {d.max === 1 ? 'an enemy unit' : `up to ${d.max} enemy units`} in the creeping
        overgrowth. This turn, the first command your opponent uses for it costs 1 more CP unless it
        is wholly within 12&quot; of a Hero.
      </p>
      <div className="ready" role="group" aria-label="Targets">
        {d.units.map((id) => (
          <button
            key={id}
            className={`chip enemy ${picked.includes(id) ? 'chosen' : ''}`}
            aria-pressed={picked.includes(id)}
            data-dread={id}
            onClick={() => toggle(id)}
          >
            {state.units[id]?.name ?? id}
          </button>
        ))}
      </div>
      <div className="stack">
        <button
          className="btn primary wide"
          data-testid="dread-use"
          disabled={picked.length === 0}
          onClick={() => dispatch({ t: 'choose', value: picked.join(',') })}
        >
          Use Creeping Dread
        </button>
        <button
          className="btn wide"
          data-testid="dread-pass"
          onClick={() => dispatch({ t: 'pass' })}
        >
          Pass
        </button>
      </div>
    </Modal>
  );
}

export function DecisionPrompts() {
  const d = useHumanDecision();
  const state = useGameState();
  const human = useHuman();
  if (!d) return null;
  if (d.kind === 'priority') {
    return (
      <Modal title={d.reason ? 'First turn' : 'Priority roll'} testId="priority">
        {d.reason ? (
          <p data-testid="first-turn-reason">
            {state.deploymentFinishedFirst === human
              ? 'You finished deploying first.'
              : 'You are the attacker.'}
          </p>
        ) : (
          <div className="dice-pair">
            <div>
              <Die value={d.rolls[0]} />
              <span className="muted small">{playerName(0)}</span>
            </div>
            <div>
              <Die value={d.rolls[1]} />
              <span className="muted small">{playerName(1)}</span>
            </div>
          </div>
        )}
        <p>You choose who takes the first turn of round {state.round}.</p>
        <div className="stack">
          <button
            className="btn primary wide"
            onClick={() => dispatch({ t: 'choose', value: 'first' })}
          >
            Take first turn
          </button>
          <button className="btn wide" onClick={() => dispatch({ t: 'choose', value: 'second' })}>
            Take second turn
          </button>
        </div>
      </Modal>
    );
  }
  if (d.kind === 'fugitive') {
    return (
      <Modal title="Burning for Vengeance" testId="fugitive">
        <p>
          Pick an enemy Hero to be the <strong>fugitive</strong> for the rest of the battle. Quick
          Pursuit and Bring Them In are scored against it (or completed once it is gone).
        </p>
        <div className="stack">
          {d.units.map((id) => {
            const u = state.units[id];
            return (
              <button
                key={id}
                className="btn wide"
                data-fugitive={id}
                onClick={() => dispatch({ t: 'choose', value: id })}
              >
                {u?.name ?? id}
                {u?.status === 'reserve' && <span className="muted small"> · in reserve</span>}
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }
  if (d.kind === 'reaction') {
    const pain = d.options.find((o) => o.ability === 'fightThroughThePain');
    if (pain) {
      return (
        <PainPrompt key={d.trigger} option={pain} fury={state.players[human].furyLevel ?? 0} />
      );
    }
    const cp = state.players[human].cp;
    return (
      <Modal title="Reaction" testId="reaction">
        <p>{reactionText(d.trigger, logContext(state.units))}</p>
        <div className="stack">
          {d.options.map((o, i) => {
            const unitName = state.units[o.unit]?.name ?? o.unit;
            if (o.ability === 'unbind') {
              return (
                <button
                  key={i}
                  className="btn wide"
                  onClick={() => dispatch({ t: 'ability', unit: o.unit, abilityId: 'unbind' })}
                >
                  Unbind · {unitName} · Free
                </button>
              );
            }
            if (!o.command) return null;
            const command = o.command;
            return (
              <button
                key={i}
                className="btn wide"
                disabled={o.cost > cp}
                onClick={() => dispatch({ t: 'command', command, unit: o.unit })}
              >
                {COMMAND_NAMES[command]} · {unitName} · {o.cost} CP
              </button>
            );
          })}
          <button className="btn primary wide" onClick={() => dispatch({ t: 'pass' })}>
            Skip
          </button>
        </div>
      </Modal>
    );
  }
  if (d.kind === 'placeOfPower') {
    const heroName = state.units[d.hero]?.name ?? 'Hero';
    return (
      <Modal title="Place of Power" testId="place-of-power">
        <p>
          <strong>{heroName}</strong> is within 3&quot; of a Place of Power at the start of the
          turn. Choose a boon for this turn (once per turn for your army), or pass.
        </p>
        <p className="muted small">
          Roll 1D6: on a 1, {heroName} suffers D3 mortal damage backfire. On a 2+, the chosen boon
          is granted.
        </p>
        <div className="stack">
          <button
            className="btn wide"
            onClick={() => dispatch({ t: 'choose', value: 'ignite_fury' })}
          >
            <strong>Ignite Fury</strong>
            <span className="muted small block">+2 Rage Dice &amp; +2 Fury Level</span>
          </button>
          <button
            className="btn wide"
            onClick={() => dispatch({ t: 'choose', value: 'channelled_wrath' })}
          >
            <strong>Channelled Wrath</strong>
            <span className="muted small block">
              +1 to this hero&apos;s casting &amp; chanting rolls this turn
            </span>
          </button>
          <button
            className="btn wide"
            onClick={() => dispatch({ t: 'choose', value: 'dizzying_rage' })}
          >
            <strong>Dizzying Rage</strong>
            <span className="muted small block">
              This hero can unbind or banish once this turn, even if it is no Wizard
            </span>
          </button>
          <button className="btn primary wide" onClick={() => dispatch({ t: 'pass' })}>
            Pass
          </button>
        </div>
      </Modal>
    );
  }
  if (d.kind === 'alarielleSeason') {
    const last = state.alarielleSeason?.[state.round - 1];
    return (
      <Modal title="Alarielle: Season of War" testId="alarielle-season">
        <p>Pick a Season of War for the rest of this battle round (not last round&apos;s):</p>
        <div className="stack">
          {SEASONS.map((x) => (
            <button
              key={x.id}
              className="btn wide"
              data-season={x.id}
              disabled={!d.seasons.includes(x.id)}
              onClick={() => dispatch({ t: 'choose', value: x.id })}
            >
              <strong>{x.name}</strong>
              <span className="muted small block">
                {x.id === last ? 'Picked last battle round' : x.text}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  if (d.kind === 'creepingDread') {
    return <CreepingDreadPrompt key={state.round * 10 + state.turnIndex} d={d} />;
  }
  return null;
}

export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const close = useUi((s) => s.closeConfirm);
  if (!confirm) return null;
  return (
    <Modal title="Are you sure?" testId="confirm">
      <p>{confirm.text}</p>
      <div className="confirm-row">
        <button className="btn" onClick={close}>
          Go back
        </button>
        <button
          className="btn primary grow"
          data-testid="confirm-ok"
          onClick={() => {
            close();
            confirm.action();
          }}
        >
          {confirm.ok}
        </button>
      </div>
    </Modal>
  );
}

/** Several units under one finger: pick which one was meant. */
export function Chooser() {
  const chooser = useUi((s) => s.chooser);
  const state = useGameState();
  const human = useHuman();
  if (!chooser) return null;
  const close = () => useUi.getState().setChooser(null);
  return (
    <div className="chooser-wrap">
      <div className="scrim clear" onClick={close} />
      <div
        className="chooser"
        style={{
          left: Math.max(8, Math.min(chooser.x - 110, window.innerWidth - 228)),
          top: chooser.y + 12,
        }}
        data-testid="chooser"
      >
        <p className="muted small">Which unit?</p>
        {chooser.units.map((id) => {
          const u = state.units[id]!;
          return (
            <button
              key={id}
              className="chooser-item"
              onClick={() => useUi.getState().select(id)}
              data-choose-unit={id}
            >
              <span
                className={`side-mark ${u.owner === human ? 'friendly' : 'enemy'}`}
                aria-hidden="true"
              />
              {u.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function GameEnd() {
  const state = useGameState();
  const human = useHuman();
  const newGame = useGame((s) => s.newGame);
  if (state.status !== 'ended') return null;
  const enemy = human === 0 ? 1 : 0;
  const title = state.winner === 'draw' ? 'A draw' : state.winner === human ? 'Victory' : 'Defeat';
  return (
    <Modal title={title} testId="game-end">
      <table className="vp-table">
        <thead>
          <tr>
            <th>Round</th>
            <th>{playerName(human)}</th>
            <th>{playerName(enemy)}</th>
          </tr>
        </thead>
        <tbody>
          {state.players[human].vpByRound.map((vp, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{vp}</td>
              <td>{state.players[enemy].vpByRound[i] ?? 0}</td>
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td>{state.players[human].vp}</td>
            <td>{state.players[enemy].vp}</td>
          </tr>
        </tbody>
      </table>
      <div className="stack">
        <button
          className="btn primary wide"
          onClick={() => {
            useUi.getState().reset();
            newGame(randomSeed(), human);
            useUi.getState().moveCamera({ kind: 'fit' });
          }}
        >
          New game
        </button>
        <button className="btn wide" onClick={() => useUi.getState().openDrawer('log')}>
          Battle log
        </button>
      </div>
    </Modal>
  );
}
