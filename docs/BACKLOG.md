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

### R5 Owner rulings: Fight Through the Pain, per-Wyldwood Burgeoning, tap-to-pick terrain

- **Tier**: sonnet+review
- **Touches**: rules, engine, ui/prompts, ui/board
- **Read**: `docs/RULES-DECISIONS.md` (I66, I67 and the 2026-11-18 rulings), `src/rules/factions/seasons.ts`, `src/rules/factions/sylvaneth.ts`, `src/engine/damage.ts`, `src/engine/combat.ts`, the season prompt in `src/ui/prompts/`
- **Done when**: (a) Fight Through the Pain is offered for Eruption of Fury's self-damage on 1s and for Metamorphosis's main hit, with tests. (b) Under The Burgeoning, the player picks a terrain feature for each of their Wyldwoods, and the NPC still picks the one closest to the centre, with tests. (c) Terrain picks are made by tapping or clicking the feature on the board, with the candidates highlighted, instead of from a list, on both phone and desktop. (d) Enemy faction terrain not controlled by an enemy unit is a valid overgrowth target for Ever Growing and for the Burgeoning pick, with tests. Everything is recorded in RULES-DECISIONS.

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
