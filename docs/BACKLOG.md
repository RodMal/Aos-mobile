# Backlog

The loop (`.claude/skills/aos-loop/SKILL.md`) takes the **first task under "Ready"**, does it as one PR, then deletes its section from "Ready" in that PR (and nothing else in this file, so parallel PRs do not conflict). The merged PR, titled `<id>: <title>`, is the record of completion. Keep each task small enough for one PR and one agent.

Task fields:

- **Tier**: who does it. `haiku` (mechanical: docs, renames, test expectations), `sonnet` (most features and fixes), `sonnet+review` (rules or engine changes: Sonnet implements, Opus reviews the diff before the PR), `opus` (only when the task needs design across many modules).
- **Read**: the files to start from, so the agent does not explore.
- **Touches**: short area tags (`engine`, `rules`, `ai`, `ui/prompts`, `ui/board`, `ui/sheet`, `ui/drawers`, `e2e`, `ci`, `docs`) derived from Read. The loop runs Ready tasks in parallel only when their Touches do not overlap.
- **Done when**: the tests that must exist and pass.
- **Ruling**: the owner's words, where a rule is involved. Rulings are final; record them in `docs/RULES-DECISIONS.md` when implemented.

Rules for every task are in `CLAUDE.md`; agents read it, so tasks do not repeat them.

## Ready

### U5 3" enemy zones while moving

- **Tier**: sonnet
- **Touches**: ui/board
- **Read**: `src/ui/board/GhostLayer.tsx`, `src/ui/board/layers.tsx`
- **Done when**: during a normal move or run, the area within 3" of every enemy unit is shaded faintly; screenshot checked on phone and desktop.

### U6 Overgrowth shading

- **Tier**: sonnet
- **Touches**: engine, ui/board
- **Read**: `src/engine/overgrowth.ts`, `src/ui/board/layers.tsx`
- **Done when**: a light, toggleable shading shows where the creeping overgrowth reaches, updating as it changes.

### R3 Overgrowth spreading to terrain features

- **Tier**: sonnet+review
- **Touches**: engine, rules
- **Read**: `src/engine/overgrowth.ts`, `src/rules/factions/sylvaneth.ts`; printed text of Ever Growing, Endless Growth, Budding Forest, The Land Awakens in `data/factions/sylvaneth.json`
- **Owner's report**: overgrowth never spreads to terrain features in play.
- **Done when**: the rule that places overgrown tokens on terrain features fires as printed, with tests; each overgrown feature is marked on the board and logged.

### R4 Leftovers from earlier rules work

- **Tier**: sonnet+review
- **Touches**: rules, ui/prompts
- **Read**: `src/rules/core/fury.ts`, the fugitive pick in `src/ui/prompts/`, Seasons Of War in `src/rules/factions/sylvaneth.ts`
- **Done when**: Fight Through the Pain is also offered for mortal damage outside attacks; the Burning for Vengeance fugitive pick highlights the candidates on the board; The Burgeoning lets the player pick its terrain feature.

### X1 Split `src/engine/engine.ts` into phase modules

- **Tier**: sonnet+review
- **Touches**: engine, docs
- **Why**: 1,890 lines that every engine task has to read; the main cost of past agents.
- **Done when**: `engine.ts` keeps only `createEngine` and the decision/apply dispatch (under about 400 lines); phases, commands, reactions and set-up each live in their own module under `src/engine/`; `pnpm game-hashes` prints `IDENTICAL` against a baseline saved before the change; no behaviour or public API change; `docs/HANDOVER.md` code map updated.

### X2 Split `src/rules/core/battleTactics.ts` per card, and `src/ui/prompts/Prompts.tsx` per prompt

- **Tier**: sonnet
- **Touches**: rules, ui/prompts, e2e
- **Done when**: one module per tactic card plus a shared core; one component per prompt plus a small router; `pnpm game-hashes` `IDENTICAL`; e2e green.

### M4a Audit of the abilities on both lists

- **Tier**: sonnet
- **Touches**: rules, engine, docs
- **Read**: `src/data/lists.ts`, `data/factions/{sylvaneth,seraphon}.json`, `src/rules/`, `src/engine/abilities/`
- **Done when**: a table in `docs/ABILITIES.md` lists every ability on the owner's two lists (warscrolls, battle traits, formation, enhancements, manifestations, faction terrain) with its BSData id and status (implemented with test / partly / missing), and one new backlog task per missing ability group is added below.

## Waiting on the owner

- The true size of the Awakened Wyldwood pieces: the traced outlines came out 6.6 to 8.5" long and 2.05 to 2.55" wide, below the owner's stated ranges. A real measurement of one piece fixes the scale (`src/data/wyldwood.ts`).
- Whether ruins and outcrops block standing (currently allowed under the 1" ruling: `LOW_TERRAIN_KINDS` in `src/data/battlefield.ts`), and moving across a spire.

## Later

- M5: the hard NPC (planner and bounded search in the worker, three difficulties, self-play measurement), as scoped in `docs/ROADMAP.md`.
- M6: more battleplans, list import, more units, data refresh.

## Done

History before the loop is in git and in `docs/RULES-DECISIONS.md`. Older entries are kept as history; new completions are the merged PRs (`<id>: <title>`), not lines here.

R1 — Redeploy timing, and Redeploy counts as a run
R2 — Free pile-in after a charge
