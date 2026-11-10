# CLAUDE.md

A phone-first web app for playing Warhammer Age of Sigmar 4 against a computer opponent. Start with `docs/HANDOVER.md` (current state and what comes next), then `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

## Rules of the road

- **Playable first.** Every change should move toward, or keep, a game a person can play on a phone. Do not polish a layer that no player can reach yet.
- **Keep the process light.** No ADR mill, no hook maze, no backlog bureaucracy. The docs are the files in `docs/` plus `data/SOURCE.md`; keep `docs/HANDOVER.md` current when a milestone lands.
- **The core is pure.** `src/geom`, `src/engine`, `src/rules`, `src/ai` and `src/data` take no DOM, React, `Math.random` or `Date.now`. All dice come from `GameState.rng`.
- **`src/engine/types.ts` is the contract** between engine, UI and NPC. Change it deliberately and update all three.
- **Never hand-edit** `data/factions/*.json`, `data/lores.json` or `data/ruleset.json` (see `data/SOURCE.md`). Rule behaviour goes in `src/rules`.
- **Faction abilities are hand-written and tested**, one test per ability. Do not generate behaviour from ability text.
- Record every rules interpretation or simplification in `docs/RULES-DECISIONS.md`.
- **Subagent models (owner's instruction, 2026-11-10):** run subagents on Opus, Sonnet or Haiku as the task warrants; use Fable only where required.

## Commands

`pnpm check` (lint, typecheck, unit tests) · `pnpm test:sim` · `pnpm test:e2e` · `pnpm format` · `pnpm build`

pnpm only. Conventional commits (`feat(engine): ...`). Never force-push.
