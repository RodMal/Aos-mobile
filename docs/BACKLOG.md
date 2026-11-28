# Backlog

The loop (`.claude/skills/aos-loop/SKILL.md`) takes the **first task under "Ready"**, does it as one PR, then deletes its section from "Ready" in that PR (and nothing else in this file, so parallel PRs do not conflict). The merged PR, titled `<id>: <title>`, is the record of completion. Keep each task small enough for one PR and one agent.

Task fields:

- **Tier**: who does it. `haiku` (mechanical: docs, renames, test expectations), `sonnet` (most features and fixes), `sonnet+review` (rules or engine changes: Sonnet implements, Opus reviews the diff before the PR), `opus` (only when the task needs design across many modules).
- **Read**: the files to start from, so the agent does not explore.
- **Touches**: short area tags (`engine`, `rules`, `ai`, `ui/prompts`, `ui/board`, `ui/sheet`, `ui/drawers`, `ui/npc` (`src/worker`, `src/ui/npc`), `e2e`, `ci`, `docs`) derived from Read. The loop runs Ready tasks in parallel only when their Touches do not overlap.
- **Done when**: the tests that must exist and pass.
- **Ruling**: the owner's words, where a rule is involved. Rulings are final; record them in `docs/RULES-DECISIONS.md` when implemented.

Rules for every task are in `CLAUDE.md`; agents read it, so tasks do not repeat them.

## Ready

### M5b Self-play harness and timings

- **Tier**: sonnet
- **Touches**: ai, ci
- **Read**: `scripts/game-hashes.ts`, `tests/sim/full-game.test.ts`, `src/engine/test-helpers.ts`, `package.json`
- **Done when**: pure `src/ai/selfplay.ts` `playMatch(engine, seed, [npcA, npcB], opts)` returns the winner, VP, decision count and search steps per side. `pnpm selfplay A=<config|baseline> B=<…> N=40` (the script already named in `package.json`; `scripts/selfplay.ts` does not exist yet) plays each seed with sides swapped and prints A's win/draw/loss, mean VP margin, ms per decision (mean, p95, max) and max ms per NPC turn. Repeated runs give identical results. Unit test: baseline vs baseline on seed 1 matches game-hashes. HANDOVER records the measured ms per game and per decision, and an estimated Node-to-phone factor.

### M5c Position evaluation with configurable weights

- **Tier**: sonnet+review
- **Touches**: ai
- **Read**: `src/engine/expected.ts`, `src/rules/core/objectives.ts`, `src/rules/core/battleTactics.ts`, `src/rules/battleplans/index.ts`, `src/engine/query.ts`
- **Done when**: `src/ai/evaluate.ts` provides `features(engine, state, player): number[]` (a named list) and `evaluate(weights, features)`. Features cover VP difference; VP still to come from objectives held over the rounds left; the points-weighted share of each army still alive; battle-tactic progress; expected-damage threat both ways (from `expected.ts`). Tests: features for player 0 are the negation of player 1's; with hand-set weights the score rises when VP +1, an enemy model is slain, or an objective is newly controlled; the functions never read `state.rng`; under 2 ms on a full mid-game state (generous bound).

### M5d Search core: forked chance and a search-step budget

- **Tier**: opus
- **Touches**: ai
- **Read**: `src/engine/engine.ts`, `src/engine/rng.ts`, `src/engine/clone.ts`, `src/engine/decisions.ts`, `src/engine/types.ts`, `src/ai/baseline.ts`
- **Done when**: `src/ai/search.ts` provides `forkChance(state, salt, sample)` (a copy whose dice come from a seed mixed from seed, round, turn, salt and sample, never from `state.rng`); `resolve(engine, state, action, player, opponentModel)` (applies the action and answers every following sub-decision until `player` next has a `main` or `fightPick` decision); `pickBest(candidates, score, budget)` (deterministic tie-break, stops after `budget.nodes` search steps). Tests: (a) the input state, including `rng`, is unchanged after a search; (b) two states differing only in `rng` give the same choice, so the NPC never sees the real dice; (c) the budget is respected; (d) the chosen action is legal, and `defaultAction` is returned when nothing is chosen. The budget counts search steps, never wall-clock time.

### M5e Champion v1: attack targets, fight order and charges by search

- **Tier**: sonnet+review
- **Touches**: ai, ci
- **Read**: `src/ai/search.ts`, `src/ai/evaluate.ts`, `src/ai/baseline.ts`, `src/engine/combat.ts`, `src/engine/eligibility.ts`
- **Done when**: behind the switches `targets`, `fightOrder` and `charges`, the NPC searches shoot and fight allocations from `targetOptions` (whole-unit or split, all-out attack on or off), which unit fights next (`fightPick`), each charge declaration (2D6 odds or forked samples) and pile-in versus pass; everything else stays baseline. `champion.json` becomes version 1 with hand-set weights. `pnpm selfplay A=champion B=baseline N=40` wins at least 60%, with the output in the PR. Max ms per decision in Node is at most 1.5 s divided by the Node-to-phone factor from M5b. One unit test per choice.

### M5f Champion-versus-challenger gate in CI

- **Tier**: sonnet
- **Touches**: ci, ai
- **Read**: `.github/workflows/ci.yml`, `vitest.sim.config.ts`, `tests/sim/full-game.test.ts`, `src/ai/selfplay.ts`
- **Done when**: `tests/strength/gate.test.ts` runs in a new `strength` job required by `ci-ok`. When `version` in `champion.json` differs from `origin/main`'s (read with `git show`), the branch's champion must beat main's: at least 55% wins and a positive mean VP margin over 40 fixed seeds × 2 sides. On every PR both champions also play the baseline, and the branch's champion must not fall below its recorded score in `src/ai/params/ladder.json` minus a named tolerance. The same job plays 4 seeds champion vs champion under `InvariantChecker`. Sharded to stay under ~12 minutes; if needed both sides use the same fixed reduced CI budget (a named constant). Unit test of the version-bump detection.

### M5g Worker budget, watchdog and "Thinking…"

- **Tier**: sonnet
- **Touches**: ui/npc, ui/board, e2e
- **Read**: `src/worker/npc.worker.ts`, `src/ui/npc/npcClient.ts`, `src/ui/App.tsx`, `src/ui/hud`, `tests/e2e/helpers.ts`
- **Done when**: `src/ai/budget.ts` sets search steps per decision and per turn, calibrated from M5b to about 1.5 s per decision and under 20 s per NPC turn on a Pixel 11 Pro XL. The worker returns `{ action, nodes }`. `npcClient` has a 3 s watchdog that restarts the worker and plays the baseline action (the only time-based path, in the UI layer). The main-thread fallback is the baseline, so search never runs on the UI thread. The top bar shows "Thinking…" while the NPC works. e2e on pixel-7 and desktop with `?e2e&npc=champion`: frames keep advancing and a pan moves the board while the NPC thinks. Watchdog unit test with fake timers.

### M5h Self-play training: tuned evaluation weights

- **Tier**: opus
- **Touches**: ai, docs
- **Read**: `src/ai/selfplay.ts`, `src/ai/evaluate.ts`, `src/ai/params/schema.ts`, `src/engine/rng.ts`
- **Done when**: pure `src/ai/train/` (1) generates positions from champion-vs-champion games, with variety from the game seeds plus a training-only seeded choice among the top-k candidates (never `Math.random`); (2) labels each position with the game's outcome and final VP margin; (3) fits the weights by deterministic L2-regularised logistic regression. `pnpm train --seed S --games G` writes a challenger config; the same seed and game count give a byte-identical file (unit test on a 2-game fixture). Training runs locally only; the PR states the seed and game count. The challenger passes the M5f gate and becomes champion version 2. HANDOVER documents the commands.

### M5i Movement and objective planning

- **Tier**: opus
- **Touches**: ai
- **Read**: `src/ai/placement.ts`, `src/ai/baseline.ts`, `src/ai/sylvaneth.ts`, `src/ai/seraphon.ts`, `src/ai/search.ts`, `src/ai/evaluate.ts`
- **Done when**: behind the `movement` switch, the NPC generates per-unit destinations (hold, each objective within reach, out of enemy threat, a screen, a charge set-up, run versus normal move), uses `placement.ts` for legal placements and orders activations with a greedy beam of width at most 3 within the budget. Tests: a unit takes an uncontested objective in reach rather than walking at the nearest enemy; a fragile ranged hero stays out of charge range when it can. Weights retrained with `pnpm train`. Passes the gate as the next champion version.

### M5j Hero phase, commands and reactions

- **Tier**: sonnet+review
- **Touches**: ai
- **Read**: `src/ai/baseline.ts`, `src/engine/commands.ts`, `src/engine/reactions.ts`, `src/engine/manifestations.ts`, `src/engine/anyPhase.ts`, `src/ai/search.ts`
- **Done when**: behind the `heroPhase` switch, the NPC uses search plus forked samples to choose spell and prayer targets and order, manifestation summons, command-point spending (rally, all-out attack and defence, counter-charge, redeploy, power through) and how many CP to keep for the opponent's turn, and which reaction to take when one is offered. The value of a kept CP is a learnable prior fitted by `pnpm train`. One test per choice. Passes the gate as the next champion version.

### M5k Deployment and the first-turn choice

- **Tier**: sonnet+review
- **Touches**: ai
- **Read**: `src/engine/deployment.ts`, `src/ai/placement.ts`, `src/ai/reserve.ts`, `src/ai/evaluate.ts`
- **Done when**: behind the `deployment` switch, each deploy placement is picked from candidate slots by score (with a turn-1 threat term); ambush or reserve is compared with an on-table slot; taking the first or second turn is decided by comparing one simulated turn each way. Tests: no unit lands inside enemy charge threat when a safe slot exists; the first-turn choice flips in a constructed state. Gated on `deploy: true` games as well; passes the gate as the next champion version.

### M5l Learned search order and the opponent's reply

- **Tier**: opus
- **Touches**: ai
- **Read**: `src/ai/search.ts`, `src/ai/train/`, `src/engine/turns.ts`
- **Done when**: `pnpm train` also fits search-order priors (how often each kind of candidate, by phase and option type, is the one the search picks), and the search tries likely candidates first. Behind the `reply` switch, plans made at the end of movement and charge are scored after the opponent's next shooting and fight, with the opponent's choices from `opponentModel` (baseline by default), over K forked samples. Max time per decision and per turn stays within the M5g budget. Passes the gate as the next champion version.

### M5m Learns from the owner's games

- **Tier**: opus
- **Touches**: ai, ui/npc, ui/drawers
- **Read**: `src/ai/params/schema.ts`, `src/ai/train/`, `src/ui/game/session.ts`, `src/ui/game/store.ts`, `src/ui/drawers/Menu.tsx`, `src/worker/npc.worker.ts`
- **Done when**: plain JSON in localStorage under `aos.npc.memory` holds `{ npcVersion, rulesVersion, games, opponentModel, weightDelta }`. At game end the worker updates, outside any game, an opponent model of the owner (charge rate by distance, which targets the owner attacks, how the owner spends commands), used by `resolve` for the owner's replies, and a small weight adjustment fitted from the game's positions. Bounds: the adjustment is clamped to ±15% of each champion weight and pulled back toward the champion; only the last 50 games count (decaying counts); the stored memory is under 20 KB. The memory is read when a new game starts and stays fixed for that game; it is discarded when `npcVersion` or `rulesVersion` no longer matches. The game record gets an optional `npc: { version, memoryHash }`; replays never consult the NPC, and a test replays a save after the memory has changed. Reset: per the owner's answer (see "Waiting on the owner"). Offline test: against a scripted owner stand-in (the baseline with a quirk, e.g. it always charges) the adapted NPC wins more over 20 seeds than the champion, and does not fall more than 5 points below the champion against the plain baseline. e2e on a phone and desktop: finish a game, memory exists, reset clears it.

### M5n Docs for M5

- **Tier**: haiku
- **Touches**: docs
- **Read**: `docs/HANDOVER.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`
- **Done when**: HANDOVER and ARCHITECTURE cover the AI code map (`index`, `evaluate`, `search`, `budget`, `selfplay`, `train`, `params`); that the NPC never reads `state.rng`; how a champion ships (train, then gate, then version bump); the device memory and its reset; the test-only `npc=baseline` switch on the `?e2e` page; the ladder of champion results. The ROADMAP M5 row is marked done.

## Waiting on the owner

- The true size of the Awakened Wyldwood pieces: the traced outlines came out 6.6 to 8.5" long and 2.05 to 2.55" wide, below the owner's stated ranges. A real measurement of one piece fixes the scale (`src/data/wyldwood.ts`).
- Whether a model may end a move on a ruin or outcrop: **Owner ruling (2026-11-22): keep for now** (allowed under the 1" ruling; `LOW_TERRAIN_KINDS` in `src/data/battlefield.ts`). Settled for now; see I53 and I57.
- M5m reset: may the menu have a 'Reset what the NPC learned' item (in About), or should the NPC's learned memory reset only automatically when a new champion ships? (asked 2026-11-28)

## Later

- M5: in Ready as M5a–M5n (owner decisions 2026-11-28: one NPC, no difficulty levels; pre-trained by self-play, a challenger ships only by beating the champion; later adapts to the owner's games).
- M6: more battleplans, list import, more units, data refresh.

## Done

History before the loop is in git and in `docs/RULES-DECISIONS.md`. Older entries are kept as history; new completions are the merged PRs (`<id>: <title>`), not lines here.

R1 — Redeploy timing, and Redeploy counts as a run
R2 — Free pile-in after a charge
