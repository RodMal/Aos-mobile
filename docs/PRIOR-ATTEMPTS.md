# What the earlier attempts taught us

Three repositories came before this one. Each got one layer right and none reached a person playing a full game on a phone. This is what was learned from them and what this project took from each. Surveyed on 2026-11-10.

## Summary

| Repo                        | What it is                                          | What worked                                                                                                             | Why it stopped                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aos-webapp` (May–Aug 2026) | A rules engine with a 3D board and an MCTS opponent | Broad, well-tested rules: turn sequence, commands, combat maths, scoring, battleplans, battle tactics, the season rules | The player could only press "End phase". The engine could not be driven by a UI, and effort went into rules fidelity instead                                                                  |
| `BSData-parser` (Oct–Nov)   | A data pipeline and a deployment trainer            | Complete data for every faction, exact geometry in inches, formations, a list validator, 12 battleplan maps             | It was finished, but only for deployment. The board had no zoom or pan, and after a one-day skeleton came 17 days of edge-case polish under heavy process (9 agents, 10 hooks, 39 ADRs)       |
| `aos-guru` (Oct)            | A tournament-prep site                              | Tested expected-damage maths, stat parsers, a BSData parser                                                             | No game engine at all. It stalled at human approval gates and on points-classification edge cases; everything was server-side with a database, and ability text was deliberately never stored |

**The shared pattern:** completeness of data or rules came before a playable loop, and process overhead grew faster than the product. This project inverts that: every milestone ends with something playable on a phone, and the process is a handful of docs and one CI workflow.

## `aos-webapp`: rules without a way to play

The engine (`packages/game-engine`, about 11k lines and 920 tests) covers most of the core rules. Its design is what kept a UI from ever being attached:

- Dice come from a global, mutable random generator, warscrolls live in a module-level registry, and ids use the clock. A game state cannot be saved, sent to a worker or replayed.
- There is no model of a player decision. Attacks roll hit, wound and save in one call, so there is no moment to use a reaction; a charge rolls and moves in one call, so a person cannot roll and then place.
- Units move as rigid blocks measured centre to centre, and illegal actions are silently ignored, so a UI cannot say why something was refused.
- Abilities were generated from their text by regular expressions. About 73% were left unmapped, and mapped ones lost their conditions (a rule that applies only inside the Sylvaneth overgrowth became permanent). Faction battle traits never ran at all.
- The opponent searched one action at a time with six coarse moves per unit, on the main thread. Its own tuner could not show it was stronger than noise.

**Taken from it:** the rule logic and test cases, re-typed for a new engine: dice, priority, command points, commands, weapon abilities, the attack sequence, fight order, objectives, scoring, battleplan and battle tactic content, the season rules. **Left behind:** its state model, the ability generator, the 3D board, the opponent.

## `BSData-parser`: excellent foundations, one phase of the game

**Taken from it:** the generated Sylvaneth, Seraphon and universal data with its zod schemas; geometry (`footprint`, `geometry`, `coherency`, `formation`) with property tests; the seeded random generator; the Into the Fire map. Later: its deployment rules and deployment opponent, and its list import.

**Left behind:** the board (fixed to the viewport, keyboard-first, desktop layout) and the process (an orchestrator that may not edit files, a reviewer and progress-keeper for every task).

Gaps it leaves: abilities are text only, core commands and scoring are absent, and the maps have no terrain.

## `aos-guru`: maths, and a warning about gates

**Taken from it:** the expected-damage maths (for target choice and the opponent) and the terrain positions for Into the Fire.

**Left behind:** Next.js, the database, the snapshot-promotion workflow and the backlog loop. Two tasks waited on answers that never came, and the automated loop spent its effort on edge cases a player would never see.

## What this project does differently

1. **Playable first.** The order is: see the armies, move them, play a full game against a simple opponent, then add the remaining rules, then make the opponent hard.
2. **An engine built to be played.** Every choice is a decision the engine asks a player for; dice and placement are separate steps; refusals come with reasons; the whole game is a seed and a list of actions.
3. **Rules written by hand and tested**, one ability at a time, for the two army lists in play. Nothing is generated from ability text.
4. **A board made for a thumb.** Pinch-zoom, pan, padded touch targets, unit drag with automatic formation and per-model adjustment.
5. **A light process.** Four docs, one CI workflow, conventional commits.
