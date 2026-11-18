# CLAUDE.md

A web app for playing Warhammer Age of Sigmar 4 against a computer opponent, on a phone or at a desktop browser. `docs/HANDOVER.md` is the project guide (goal, decisions, code map, how to work); `docs/BACKLOG.md` is what to do next.

## How work happens

- **Run the loop.** To continue development, use the `aos-loop` skill (`.claude/skills/aos-loop/SKILL.md`): the main session orchestrates; agents in `.claude/agents/` implement (`aos-dev`, Sonnet), do mechanical work (`aos-chore`, Haiku) and review or advise (`aos-review`, Opus).
- **Branches and PRs.** `main` is the released branch and deploys after CI passes. Every change goes through a PR from a `task/<id>` branch off `origin/main`, whatever working branch a session was opened on. Never push to `main` directly; never force-push.
- **Merging.** The owner merges task PRs. The loop may merge a PR itself only if the owner has written below that it may.
  - Loop may merge on green CI: **authorised** (owner, 2026-11-18).
- **CI is the judge.** Locally run `pnpm check` and the tests the change touches; CI runs the full simulation and e2e suites on every PR.
- **New requests from the owner** become tasks in `docs/BACKLOG.md`.

## Rules of the road

- **Playable first.** Every change keeps or moves toward a game the owner can play. Do not polish a layer no player can reach.
- **Phone and desktop are both targets.** Every UI change is checked on a phone project and on `desktop`. One code path; CSS adapts the layout.
- **The core is pure.** `src/geom`, `src/engine`, `src/rules`, `src/ai` and `src/data` take no DOM, React, `Math.random` or `Date.now`. All dice come from `GameState.rng`; state is plain JSON.
- **`src/engine/types.ts` is the contract** between engine, UI and NPC. Change it additively.
- **Never hand-edit** `data/factions/*.json`, `data/lores.json` or `data/ruleset.json` (see `data/SOURCE.md`). Rule behaviour goes in `src/rules` and `src/engine`.
- **Abilities are hand-written and tested**, keyed by BSData id, one test per ability. Never generate behaviour from ability text. Never fetch rules from the web.
- **Owner rulings are final** and live in `docs/RULES-DECISIONS.md`. Record every interpretation there.
- **No behaviour change in refactors:** `pnpm game-hashes --save` before, `pnpm game-hashes` after must print `IDENTICAL`.
- **Models:** Sonnet and Haiku do the work; Opus reviews diffs and advises. Use Opus to implement only for tasks tiered `opus`.

## Commands

`pnpm check` (lint, typecheck, unit tests) · `pnpm test:sim` · `pnpm test:e2e` · `pnpm format` · `pnpm build` · `pnpm game-hashes`

pnpm only. Conventional commits (`feat(engine): ...`). Before any local e2e run: `pkill -f "vite.js preview"`.
