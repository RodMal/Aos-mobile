# Backlog

The loop (`.claude/skills/aos-loop/SKILL.md`) takes the **first task under "Ready"**, does it as one PR, then moves it to "Done" with the PR number. Keep each task small enough for one PR and one agent.

Task fields:

- **Tier**: who does it. `haiku` (mechanical: docs, renames, test expectations), `sonnet` (most features and fixes), `sonnet+review` (rules or engine changes: Sonnet implements, Opus reviews the diff before the PR), `opus` (only when the task needs design across many modules).
- **Read**: the files to start from, so the agent does not explore.
- **Done when**: the tests that must exist and pass.
- **Ruling**: the owner's words, where a rule is involved. Rulings are final; record them in `docs/RULES-DECISIONS.md` when implemented.

Rules for every task are in `CLAUDE.md`; agents read it, so tasks do not repeat them.

## Ready

### R2 Free pile-in after a charge

- **Tier**: sonnet+review
- **Read**: `src/engine/movement.ts` (pile-in rules), `src/engine/engine.ts` (`eligibleFighters`, pile-in frame), `src/ai/placement.ts` (`pileInPlacement`), `src/ui/sheet/PlacePanel.tsx`
- **Ruling** (owner, 2026-11-12): a unit not in combat can fight, and pile in, only if it charged this turn. "If I charged, and the unit I was in combat with died, whenever I do my pile in, if I am no longer in combat with another unit, I can pile in the 3 inches whichever direction I want."
- **Done when**: tests for charged-and-in-combat (must not end further from the nearest enemy), charged-and-not-in-combat (free 3" any direction), neither (no fight offered); the pile-in hint says when it is free; NPC uses it towards the nearest enemy or objective.

### U1 Reaction prompt: see the map, and unit names

- **Tier**: sonnet
- **Read**: `src/ui/prompts/Prompts.tsx`, `src/ui/game/eventText.ts`, `src/ui/board/layers.tsx`
- **Done when**: a "See the map" button collapses the prompt to a small bar so the board can be panned, zoomed and units inspected, and one tap reopens it; the unit that triggered it is highlighted; a listed unit is highlighted when tapped or hovered. Bug: the trigger text says "1 finished a move nearby" (an id): every trigger text uses unit names. e2e on a phone project and desktop.

### U2 Show which units have fought this combat phase

- **Tier**: sonnet
- **Read**: `src/ui/board/layers.tsx`, `src/ui/drawers/Roster.tsx`, `UnitState.fought` in `src/engine/types.ts`
- **Done when**: in the combat phase, units of both sides that have fought are dimmed with a "fought" badge on the board and marked in the roster; e2e check.

### U3 Measuring tool

- **Tier**: sonnet
- **Read**: `src/ui/sheet/Rail.tsx` (board tools), `src/ui/board/Board.tsx`, `src/ui/board/hitTest.ts`, `src/geom/index.ts`
- **Owner's reason**: missed the second tier of Flanking Firestorm thinking a unit was within 9" of a corner.
- **Done when**: a toggle in the board tools; tap or click two points, or a unit and a point (corner, objective); shows the distance in inches, base edge to base edge for units; touch and mouse; e2e on phone and desktop.

### U4 Live checks for battle tactic conditions

- **Tier**: sonnet
- **Read**: the battle tactics drawer in `src/ui/drawers/`, `src/rules/core/battleTactics.ts`
- **Done when**: each tier whose condition can be evaluated on the current state shows a live met / not met indicator (for example Flanking Firestorm's "within 9 inches of a corner"), computed by pure functions in `src/rules/core/battleTactics.ts` with unit tests.

### U5 3" enemy zones while moving

- **Tier**: sonnet
- **Read**: `src/ui/board/GhostLayer.tsx`, `src/ui/board/layers.tsx`
- **Done when**: during a normal move or run, the area within 3" of every enemy unit is shaded faintly; screenshot checked on phone and desktop.

### U6 Overgrowth shading

- **Tier**: sonnet
- **Read**: `src/engine/overgrowth.ts`, `src/ui/board/layers.tsx`
- **Done when**: a light, toggleable shading shows where the creeping overgrowth reaches, updating as it changes.

### R3 Overgrowth spreading to terrain features

- **Tier**: sonnet+review
- **Read**: `src/engine/overgrowth.ts`, `src/rules/factions/sylvaneth.ts`; printed text of Ever Growing, Endless Growth, Budding Forest, The Land Awakens in `data/factions/sylvaneth.json`
- **Owner's report**: overgrowth never spreads to terrain features in play.
- **Done when**: the rule that places overgrown tokens on terrain features fires as printed, with tests; each overgrown feature is marked on the board and logged.

### R4 Leftovers from earlier rules work

- **Tier**: sonnet+review
- **Read**: `src/rules/core/fury.ts`, the fugitive pick in `src/ui/prompts/`, Seasons Of War in `src/rules/factions/sylvaneth.ts`
- **Done when**: Fight Through the Pain is also offered for mortal damage outside attacks; the Burning for Vengeance fugitive pick highlights the candidates on the board; The Burgeoning lets the player pick its terrain feature.

### X1 Split `src/engine/engine.ts` into phase modules

- **Tier**: sonnet+review
- **Why**: 1,890 lines that every engine task has to read; the main cost of past agents.
- **Done when**: `engine.ts` keeps only `createEngine` and the decision/apply dispatch (under about 400 lines); phases, commands, reactions and set-up each live in their own module under `src/engine/`; `pnpm game-hashes` prints `IDENTICAL` against a baseline saved before the change; no behaviour or public API change; `docs/HANDOVER.md` code map updated.

### X2 Split `src/rules/core/battleTactics.ts` per card, and `src/ui/prompts/Prompts.tsx` per prompt

- **Tier**: sonnet
- **Done when**: one module per tactic card plus a shared core; one component per prompt plus a small router; `pnpm game-hashes` `IDENTICAL`; e2e green.

### M4a Audit of the abilities on both lists

- **Tier**: sonnet
- **Read**: `src/data/lists.ts`, `data/factions/{sylvaneth,seraphon}.json`, `src/rules/`, `src/engine/abilities/`
- **Done when**: a table in `docs/ABILITIES.md` lists every ability on the owner's two lists (warscrolls, battle traits, formation, enhancements, manifestations, faction terrain) with its BSData id and status (implemented with test / partly / missing), and one new backlog task per missing ability group is added below.

## Waiting on the owner

- The true size of the Awakened Wyldwood pieces: the traced outlines came out 6.6 to 8.5" long and 2.05 to 2.55" wide, below the owner's stated ranges. A real measurement of one piece fixes the scale (`src/data/wyldwood.ts`).
- Whether ruins and outcrops block standing (currently allowed under the 1" ruling: `LOW_TERRAIN_KINDS` in `src/data/battlefield.ts`), and moving across a spire.

## Later

- M5: the hard NPC (planner and bounded search in the worker, three difficulties, self-play measurement), as scoped in `docs/ROADMAP.md`.
- M6: more battleplans, list import, more units, data refresh.

## Done

History before the loop is in git and in `docs/RULES-DECISIONS.md`. One line per task from here on: `id — title — PR #n`.

R1 — Redeploy timing, and Redeploy counts as a run
