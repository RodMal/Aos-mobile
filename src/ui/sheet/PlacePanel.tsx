/** Placing a unit (move, run, retreat, charge, pile-in): status, re-form tools, confirm. */
import { commandBlocker } from '../../rules/core/commands.js';
import { dispatch } from '../game/actions.js';
import { beginDraft, editDraft, engageDraft } from '../game/draftActions.js';
import { scenario } from '../game/engine.js';
import { inches } from '../game/eventText.js';
import { useDecision, useGameState } from '../game/hooks.js';
import { useGame } from '../game/instance.js';
import {
  faceEnemy,
  maxDistance,
  reformDraft,
  rotateDraft,
  setUpReach,
} from '../game/placementEdit.js';
import { useUi } from '../game/uiStore.js';
import { Icon } from '../components/Icon.js';
import { finePointer, tapWord } from '../components/pointer.js';

const TITLES: Record<string, string> = {
  normal: 'Move',
  run: 'Run',
  retreat: 'Retreat',
  charge: 'Charge',
  pileIn: 'Pile in',
  summon: 'Set up manifestation',
  powerThrough: 'Power Through',
  deploy: 'Deploy',
  setUp: 'Set up',
};

function Tool({
  icon,
  label,
  onClick,
  pressed,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      className={`tool ${pressed ? 'on' : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

export function PlacePanel() {
  const draft = useUi((s) => s.draft);
  const setDraft = useUi((s) => s.setDraft);
  const state = useGameState();
  const d = useDecision();
  if (!draft || !d || d.kind !== 'place') return null;
  const unit = state.units[draft.unit]!;
  const dist = maxDistance(unit, draft.placement);
  const first = draft.violations[0];
  // A summoned manifestation is measured from its caster, not from where it was suggested.
  const reach = setUpReach(scenario, state, draft.placement);
  const fromCaster = reach
    ? `${inches(Math.round(reach.dist * 10) / 10)} from ${reach.caster.name} (max ${inches(reach.range)})`
    : null;
  const n = draft.placement.models.length;
  const diceText =
    d.dice.length > 0
      ? ` · rolled ${d.dice.join(' + ')}${d.dice.length > 1 ? ` = ${d.dice.reduce((a, b) => a + b, 0)}` : ''}`
      : '';
  const passLabel =
    d.reason === 'pileIn'
      ? 'Skip'
      : d.reason === 'charge'
        ? 'Give up'
        : d.reason === 'run'
          ? 'Stay put'
          : 'Cancel';
  const note =
    d.reason === 'deploy'
      ? 'Drag or rotate to set up wholly within your territory (>= 9" from enemy territory).'
      : d.reason === 'charge'
        ? 'Placed in contact with the nearest enemy. Drag to choose another spot within ½" of an enemy unit.'
        : d.reason === 'pileIn'
          ? 'Piled in towards the nearest enemy. Each model may move up to 3" and must not end further from it.'
          : d.reason === 'summon'
            ? 'Drag to set up wholly within range of the caster, then confirm.'
            : d.reason === 'setUp'
              ? 'Drag or rotate to set up more than 3" from every objective, terrain feature and unit.'
              : d.reason === 'powerThrough'
                ? 'Move up to your allowance. You may stay in combat with the units you were fighting, or leave, but not enter combat with any other unit.'
                : draft.adjust
                  ? `${tapWord()} a model, then drag anywhere to move it.`
                  : finePointer()
                    ? 'Drag anywhere to move the unit. The wheel zooms; Enter confirms.'
                    : 'Drag anywhere to move the unit. Two fingers pan and zoom.';
  const canForwardToVictory =
    d.reason === 'charge' &&
    !commandBlocker(state, d.player, 'forwardToVictory', unit) &&
    !state.players[d.player].commandsUsed?.includes('forwardToVictory');

  const confirm = () => {
    if (draft.violations.length > 0) return;
    if (dispatch({ t: 'place', placement: draft.placement })) setDraft(null);
  };

  return (
    <div className="panel place-panel" data-testid="place-panel">
      <header className="place-head">
        <h2 className="panel-title">
          {TITLES[d.reason] ?? 'Place'} {unit.name}
        </h2>
        <p className="panel-hint">
          {d.reason === 'setUp'
            ? 'Hero phase · anywhere legal'
            : reach
              ? `Wholly within ${inches(reach.range)} of ${reach.caster.name}`
              : Number.isFinite(d.allowance)
                ? `Up to ${inches(d.allowance)}`
                : 'Anywhere legal'}
          {diceText}
        </p>
      </header>
      <p
        className={`place-status ${first ? 'bad' : dist > 0 ? 'ok' : ''}`}
        data-testid="place-status"
        role="status"
      >
        {first
          ? `${first.message}${fromCaster ? ` ${fromCaster}.` : ''}`
          : fromCaster
            ? `${fromCaster}. Ready to confirm.`
            : dist > 0.05
              ? `Moved ${inches(Math.round(dist * 10) / 10)}. Ready to confirm.`
              : note}
      </p>
      {first && <p className="panel-hint small">{note}</p>}
      <div className="tools" role="toolbar" aria-label="Formation">
        {(d.reason === 'charge' || d.reason === 'pileIn' || d.reason === 'deploy') && (
          <Tool
            icon="engage"
            label={d.reason === 'deploy' ? 'Auto' : 'Engage'}
            onClick={() => {
              if (!engageDraft())
                useGame.getState().showToast('No legal position found. Drag the unit.', 'error');
            }}
          />
        )}
        <Tool icon="rotl" label="−15°" onClick={() => editDraft((x) => rotateDraft(x, -15))} />
        <Tool icon="rotr" label="+15°" onClick={() => editDraft((x) => rotateDraft(x, 15))} />
        <Tool
          icon="face"
          label="Face"
          onClick={() => editDraft((x, u, s) => faceEnemy(scenario, s, u, x))}
        />
        {n > 1 && (
          <>
            <Tool
              icon="narrow"
              label="Narrow"
              onClick={() =>
                editDraft((x, u) => reformDraft(scenario, u, x, x.facing, x.frontage - 1))
              }
            />
            <Tool
              icon="wide"
              label="Widen"
              onClick={() =>
                editDraft((x, u) => reformDraft(scenario, u, x, x.facing, x.frontage + 1))
              }
            />
            <Tool
              icon="adjust"
              label="Adjust"
              pressed={draft.adjust}
              onClick={() => setDraft({ ...draft, adjust: !draft.adjust, activeModel: null })}
            />
          </>
        )}
        <Tool icon="reset" label="Reset" onClick={() => beginDraft(state, draft.unit)} />
      </div>
      {canForwardToVictory && (
        <button
          className="btn wide"
          onClick={() => {
            if (dispatch({ t: 'command', command: 'forwardToVictory', unit: d.unit })) {
              setDraft(null);
            }
          }}
          data-testid="forward-to-victory"
        >
          Forward to Victory · 1 CP
        </button>
      )}
      <div className="confirm-row">
        {d.canPass && (
          <button
            className="btn"
            onClick={() => dispatch({ t: 'pass' }) && setDraft(null)}
            data-testid="place-cancel"
          >
            {passLabel}
          </button>
        )}
        <button
          className="btn primary grow"
          disabled={draft.violations.length > 0}
          onClick={confirm}
          data-testid="place-confirm"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
