# Architecture

One package, five layers. Each layer may import only the layers above it in this list.

| Layer    | Folder                    | Job                                                                                                        |
| -------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Data     | `src/data`, `data/`       | BSData-derived JSON, zod schemas, parsed `UnitProfile`s, army lists, the battlefield                       |
| Geometry | `src/geom`                | Bases as circles, ellipses and rectangles in inches; edge-to-edge distance, overlap, coherency, formations |
| Engine   | `src/engine`, `src/rules` | Game state, the decision loop, the rules                                                                   |
| NPC      | `src/ai`                  | Chooses actions for the computer player                                                                    |
| UI       | `src/ui`, `src/worker`    | React app; talks to the engine and to the NPC worker                                                       |

Data, geometry, engine and NPC are the **core**. The core compiles without the DOM library (`tsconfig.core.json`) and ESLint blocks imports of UI code, `Math.random` and `Date.now`, so it runs unchanged in the browser, in a Web Worker and in Node tests.

## Coordinates

Inches. The origin is the top-left corner of the table, x runs right (0 to 60) and y runs down (0 to 44). Rotations are degrees, clockwise on screen. The UI rotates the whole table for portrait screens; that is a view transform only.

## The engine contract (`src/engine/types.ts`)

- **`Scenario`** is everything that never changes during a game: battlefield, both armies, unit profiles.
- **`GameState`** is plain JSON: round, phase, players, units with one position per model, objectives, the RNG state and a stack of pending steps. A game is its scenario, its seed and its list of actions, which is what makes save, resume, replay and bug reports cheap.
- **Decisions.** `engine.decision(state)` says which player must choose what: a main-phase action, where to place a unit, which unit fights next, which weapons hit which targets, whether to use a reaction. The answer is an `Action`. Decisions can belong to the player whose turn it is not.
- **Dice and placement are separate steps.** Declaring a run or a charge rolls the dice and creates a `place` decision with the distance allowed.
- **`engine.apply(state, action)`** returns a new state and a list of `GameEvent`s for the log. It never mutates its input, and it throws `IllegalActionError` (with `Violation`s the UI can show) if the action is not legal.
- **`engine.checkPlacement`** validates a placement for live drag feedback. **`engine.defaultAction`** is always legal, which is what simulations and the simplest NPC use.

Every positional action carries a position for each living model. The UI's unit drag and the NPC both build those with `formPlacement` (a formation around a centre point), so adjusting single models needs no engine change.

## Faction rules

Abilities are hand-written TypeScript in `src/rules`, one definition per BSData ability id, attached through typed hooks (modifiers evaluated with the attack in context, grants, triggers, activated abilities, reactions). The printed text shown on unit cards comes from the data; the behaviour comes from code. A guard test checks each id still exists in the data.

## Testing

- Unit tests sit next to the code (`*.test.ts`).
- `tests/sim` plays whole games from seeds and checks invariants after every action: bases never overlap or leave the table, units stay coherent, a legal action always exists, the game ends after round 5, and replaying the same seed and actions gives the same state.
- `tests/e2e` drives the built app with Playwright at phone sizes.
