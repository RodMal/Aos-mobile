/** Both armies; tapping a unit selects it and flies the camera to it. */
import { aliveCount, type PlayerId } from '../../engine/index.js';
import { playerName, scenario } from '../game/engine.js';
import { useGameState, useHuman } from '../game/hooks.js';
import { useUi } from '../game/uiStore.js';
import { Drawer } from './Drawer.js';

export function Roster() {
  const state = useGameState();
  const human = useHuman();
  const order: PlayerId[] = human === 0 ? [0, 1] : [1, 0];
  const choose = (id: string) => {
    const ui = useUi.getState();
    ui.openDrawer(null);
    ui.select(id);
    ui.moveCamera({ kind: 'unit', unit: id, zoom: true, onlyIfHidden: false });
  };
  return (
    <Drawer title="Roster" testId="roster">
      {order.map((p) => (
        <section key={p} className="roster-army">
          <h3 className={`roster-title ${p === human ? 'friendly' : 'enemy'}`}>
            <span
              className={`side-mark ${p === human ? 'friendly' : 'enemy'}`}
              aria-hidden="true"
            />
            {p === human ? 'You · ' : ''}
            {playerName(p)}
            <span className="muted small"> {scenario.armies[p].points} pts</span>
          </h3>
          <ul className="roster-list">
            {state.unitOrder
              .map((id) => state.units[id]!)
              .filter((u) => u.owner === p)
              .map((u) => {
                const alive = aliveCount(u);
                const flags = [
                  u.moved && 'moved',
                  u.charged && 'charged',
                  u.shot && 'shot',
                  u.fought && 'fought',
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={u.id}>
                    <button
                      className={`roster-item ${u.status !== 'battlefield' ? 'gone' : ''}`}
                      onClick={() => choose(u.id)}
                      disabled={u.status !== 'battlefield'}
                      data-roster-unit={u.id}
                    >
                      <span className="roster-name">{u.name}</span>
                      <span className="roster-meta">
                        {u.status === 'destroyed'
                          ? 'destroyed'
                          : `${alive}/${u.models.length}${u.damage ? ` · ${u.damage} dmg` : ''}${flags ? ` · ${flags}` : ''}`}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </Drawer>
  );
}
