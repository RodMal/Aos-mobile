/** Everything that happened, oldest first (opened at the newest); attack lines expand to show the dice. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../game/instance.js';
import { useHuman } from '../game/hooks.js';
import { buildLog, type LogEntry } from '../game/store.js';
import { Drawer } from './Drawer.js';

function Line({ e, human }: { e: LogEntry; human: 0 | 1 }) {
  const [open, setOpen] = useState(false);
  const side = e.player === undefined ? '' : e.player === human ? 'friendly' : 'enemy';
  if (e.kind === 'heading') return <li className={`log-heading ${side}`}>{e.text}</li>;
  if (!e.detail) return <li className={`log-line ${e.kind} ${side}`}>{e.text}</li>;
  return (
    <li className={`log-line ${e.kind} ${side}`}>
      <button className="log-expand" aria-expanded={open} onClick={() => setOpen(!open)}>
        {e.text}
      </button>
      {open && (
        <ul className="log-detail">
          {e.detail.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function LogDrawer() {
  const session = useGame((s) => s.session);
  const human = useHuman();
  const lines = useMemo(() => buildLog(session), [session]);
  const list = useRef<HTMLOListElement>(null);
  // Oldest first, like a chronicle; open at the newest line.
  useEffect(() => {
    const body = list.current?.parentElement;
    if (body) body.scrollTop = body.scrollHeight;
  }, [lines]);
  return (
    <Drawer title="Battle log" testId="log">
      <ol ref={list} className="log-list" data-testid="log-list">
        {lines.map((e) => (
          <Line key={e.id} e={e} human={human} />
        ))}
      </ol>
    </Drawer>
  );
}
