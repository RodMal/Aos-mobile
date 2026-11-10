# AGENTS.md

Instructions for any coding agent working in this repository.

1. Read `docs/HANDOVER.md` first: it says what the project is, what is done, what comes next and what has cost time before.
2. Follow the rules in `CLAUDE.md`. They are not specific to one tool: playable first, a light process, a pure core, `src/engine/types.ts` as the contract, no hand-edited data, hand-written and tested abilities, every rules reading recorded in `docs/RULES-DECISIONS.md`.
3. Then `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.

Before pushing: `pnpm format`, `pnpm check`, `pnpm test:sim` and `pnpm test:e2e -- --trace off` must pass. Every push deploys to the owner's phone.
