/** The app shell: top bar, battlefield, bottom sheet, drawers and prompts. */
import { useEffect } from 'react';
import { Board } from './board/Board.js';
import { ArmyRules } from './drawers/ArmyRules.js';
import { LogDrawer } from './drawers/LogDrawer.js';
import { Menu } from './drawers/Menu.js';
import { Roster } from './drawers/Roster.js';
import { TacticsDrawer } from './drawers/TacticsDrawer.js';
import { startAttack } from './game/actions.js';
import { beginDraft } from './game/draftActions.js';
import { engine } from './game/engine.js';
import { useDecision, useGameState, useHuman } from './game/hooks.js';
import { useGame } from './game/instance.js';
import { useUi } from './game/uiStore.js';
import { TopBar } from './hud/TopBar.js';
import { useKeyboard } from './hud/useKeyboard.js';
import { createNpcClient } from './npc/npcClient.js';
import { Chooser, ConfirmDialog, DecisionPrompts, GameEnd } from './prompts/Prompts.js';
import { Sheet } from './sheet/Sheet.js';

const npc = createNpcClient(engine);
const NPC_DELAY_MS = 550;

/** Keeps drafts and attack panels in step with the engine's decision. */
function useDecisionSync(): void {
  const state = useGameState();
  const d = useDecision();
  const human = useHuman();
  useEffect(() => {
    const ui = useUi.getState();
    const mine = !!d && d.player === human;
    if (mine && d.kind === 'place') {
      if (!ui.draft || ui.draft.unit !== d.unit) {
        beginDraft(state, d.unit, true);
        ui.select(d.unit);
      }
    } else if (ui.draft) {
      ui.setDraft(null);
    }
    if (mine && d.kind === 'targets') {
      if (!ui.attack || ui.attack.unit !== d.unit || ui.attack.mode !== d.mode)
        startAttack(d.unit, d.mode);
    } else if (ui.attack && (ui.attack.mode === 'fight' || !mine || d.kind !== 'main')) {
      ui.setAttack(null);
    }
  }, [state, d, human]);
}

/** Lets the computer answer its decisions, one at a time, slowly enough to follow. */
function useNpc(): void {
  const state = useGameState();
  const human = useHuman();
  const fast = useGame((s) => s.fast);
  useEffect(() => {
    const d = engine.decision(state);
    if (!d || d.player === human) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void npc
          .chooseAction(state)
          .catch((err: unknown) => {
            console.warn('The NPC failed to choose an action; using the default action.', err);
            return null;
          })
          .then((action) => {
            if (cancelled || useGame.getState().session.state !== state) return;
            // An action the engine rejects would leave the game waiting forever: fall back to
            // the engine's default action, which is always legal.
            if (action && useGame.getState().dispatch(action)) return;
            if (action)
              console.warn('The engine rejected the NPC action; using the default.', action);
            useGame.getState().dispatch(engine.defaultAction(state));
          });
      },
      fast ? 0 : NPC_DELAY_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, human, fast]);
}

/** Follows what the opponent does with the camera. */
function useNpcCamera(): void {
  const focus = useGame((s) => s.lastFocus);
  useEffect(() => {
    if (!focus) return;
    const { session } = useGame.getState();
    const last = session.history[session.history.length - 1];
    if (!last || last.actor === session.humanPlayer) return;
    useUi
      .getState()
      .moveCamera({ kind: 'unit', unit: focus.unit, zoom: false, onlyIfHidden: true });
  }, [focus]);
}

export function App() {
  useDecisionSync();
  useNpc();
  useNpcCamera();
  useKeyboard();
  const drawer = useUi((s) => s.drawer);
  const gameId = useGame((s) => s.gameId);
  return (
    <main className="app" key={gameId}>
      <TopBar />
      <div className="stage">
        <Board />
        <Sheet />
      </div>
      <Chooser />
      <DecisionPrompts />
      <GameEnd />
      <ConfirmDialog />
      {drawer === 'roster' && <Roster />}
      {drawer === 'log' && <LogDrawer />}
      {drawer === 'army' && <ArmyRules />}
      {drawer === 'menu' && <Menu />}
      {drawer === 'tactics' && <TacticsDrawer />}
    </main>
  );
}
