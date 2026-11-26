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

### M4p Pick the targets of the manifestation movement abilities

- **Tier**: sonnet+review
- **Touches**: engine, ai, ui/prompts
- **Ruling**: I112 and I113 ("can" means the controlling player chooses)
- **Read**: `src/engine/placing.ts` (`resolveSweep`, which now picks the targets), `src/engine/sweep.ts` (`passedAcross`), `src/engine/decisions.ts` and `src/ui/prompts` (how a pick decision is asked and answered, e.g. Endless Growth), RULES-DECISIONS I112, I115
- **Done when**: after a Scything Blade, End Given Form or Pulled to the Grave move, the player picks the targets (up to 3 of the units passed across, or one for Pulled to the Grave) in a prompt; the NPC keeps the automatic pick. Unit tests for the prompt and the pick, and an e2e check on phone and desktop. Bump the rules version. Update I115 and the S7 row.

### M4l Other manifestation abilities

- **Tier**: sonnet+review
- **Touches**: engine, rules, ai
- **Read**: `docs/ABILITIES.md`; printed text in the manifestation warscrolls of `data/lores.json` (Chronomantic Cogs `1aba-bc38-e988-d79f`: Mechanisms of Time `ad92-932-6f56-1d97`; Quicksilver Swords `8cde-fafe-2b2a-ced5`: Dancing Blades `7b11-c623-fc14-4639`; Purple Sun: Pull of the Nadir `c99-9240-9da1-d029`; Malevolent Maelstrom `e699-49b7-d2b8-d5fc`: Morbid Detonation `b8a4-541-b62-cf62`, Necrotic Vortex `c711-ce6-1fb6-7abc`; Soulsnare Shackles `dee3-92a0-27e7-252a`: Bound for the Great Oubliette `6817-e507-443e-1ff4`, Multiple Parts `9e13-160b-4a87-da4e`); `src/engine/abilities/magic.ts`, `src/engine/abilities/effects.ts`, `src/engine/damage.ts`, `src/engine/turns.ts`, RULES-DECISIONS S13, I24
- **Done when**: one test per ability: Mechanisms of Time (a Wizard within 3" picks re-roll charges or -1 to hit against Wizards, within 12", until your next turn), Dancing Blades (no ward rolls against its damage), Pull of the Nadir (-1 to save rolls for every unit within 3"), Morbid Detonation (mortal damage on 2+, then destroyed), Necrotic Vortex (maelstrom points from set-up, successful casts within 12" and slain models within 12", maximum 6; they drive Morbid Detonation's target count per the printed text), Bound for the Great Oubliette (D3 mortal damage and Move reduced by the roll), Multiple Parts (three parts within 3" of each other, destroyed together). Update S13 and `docs/ABILITIES.md`.

### R22 Pick which Wyldwood piece to place

- **Tier**: sonnet
- **Touches**: ui/prompts, ui/board, engine
- **Ruling**: owner request (2026-11-22)
- **Read**: `src/engine/wyldwood.ts` (how the three crescent pieces are set up and in what order), the Wyldwood set-up `place` decision in `src/engine/decisions.ts`, and `src/ui/sheet/PlacePanel.tsx`.
- **Done when**: when an Awakened Wyldwood is set up, the player chooses which of the remaining pieces (1, 2 or 3, shown with their shape and size) to place next, instead of a fixed order. The NPC keeps a sensible automatic choice. Placement legality is unchanged. Unit tests and an e2e test cover choosing a piece, on phone and desktop. Bump the rules version if replay changes.

## Waiting on the owner

- The true size of the Awakened Wyldwood pieces: the traced outlines came out 6.6 to 8.5" long and 2.05 to 2.55" wide, below the owner's stated ranges. A real measurement of one piece fixes the scale (`src/data/wyldwood.ts`).
- Whether a model may end a move on a ruin or outcrop: **Owner ruling (2026-11-22): keep for now** (allowed under the 1" ruling; `LOW_TERRAIN_KINDS` in `src/data/battlefield.ts`). Settled for now; see I53 and I57.

## Later

- M5: the hard NPC (planner and bounded search in the worker, three difficulties, self-play measurement), as scoped in `docs/ROADMAP.md`.
- M6: more battleplans, list import, more units, data refresh.

## Done

History before the loop is in git and in `docs/RULES-DECISIONS.md`. Older entries are kept as history; new completions are the merged PRs (`<id>: <title>`), not lines here.

R1 — Redeploy timing, and Redeploy counts as a run
R2 — Free pile-in after a charge
