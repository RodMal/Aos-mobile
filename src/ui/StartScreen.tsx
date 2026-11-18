/** What loading the page shows: continue the saved game, or start a new one. */
import { NewGameForm } from './drawers/NewGameForm.js';
import { useGame } from './game/instance.js';

export function StartScreen() {
  const canContinue = useGame((s) => s.canContinue);
  const resume = useGame((s) => s.resume);

  return (
    <main className="start-screen" data-testid="start-screen">
      <div className="start-card">
        <h1>AoS Mobile</h1>
        {canContinue && (
          <button className="btn primary wide" onClick={resume} data-testid="continue-game">
            Continue
          </button>
        )}
        <NewGameForm initialSide={0} />
        <p className="muted small credits">
          Game data from the community BSData project. Warhammer Age of Sigmar is © Games Workshop.
          Unofficial fan project.
        </p>
      </div>
    </main>
  );
}
