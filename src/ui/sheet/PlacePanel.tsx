/** Placing a unit (move, run, retreat, charge, pile-in): status, re-form tools, confirm. */
import { dispatch } from '../game/actions.js';
import { beginDraft, editDraft, engageDraft } from '../game/draftActions.js';
import { scenario } from '../game/engine.js';
import { inches } from '../game/eventText.js';
import { useDecision, useGameState } from '../game/hooks.js';
import { useGame } from '../game/instance.js';
import { faceEnemy, maxDistance, reformDraft, rotateDraft } from '../game/placementEdit.js';
import { useUi } from '../game/uiStore.js';
import { Icon } from '../components/Icon.js';

const TITLES: Record<string, string> = {
  normal: 'Move',
  run: 'Run',
  retreat: 'Retreat',
  charge: 'Charge',
  pileIn: 'Pile in',
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
    d.reason === 'charge'
      ? 'Placed in contact with the nearest enemy. Drag to choose another spot within ½" of an enemy unit.'
      : d.reason === 'pileIn'
        ? 'Piled in towards the nearest enemy. Each model may move up to 3" and must not end further from it.'
        : draft.adjust
          ? 'Tap a model, then drag anywhere to move it.'
          : 'Drag anywhere to move the unit. Two fingers pan and zoom.';

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
          Up to {inches(d.allowance)}
          {diceText}
        </p>
      </header>
      <p
        className={`place-status ${first ? 'bad' : dist > 0 ? 'ok' : ''}`}
        data-testid="place-status"
        role="status"
      >
        {first
          ? first.message
          : dist > 0.05
            ? `Moved ${inches(Math.round(dist * 10) / 10)}. Ready to confirm.`
            : note}
      </p>
      {first && <p className="panel-hint small">{note}</p>}
      <div className="tools" role="toolbar" aria-label="Formation">
        {(d.reason === 'charge' || d.reason === 'pileIn') && (
          <Tool
            icon="engage"
            label="Engage"
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
