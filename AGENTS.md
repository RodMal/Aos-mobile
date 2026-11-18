# AGENTS.md

Instructions for any coding agent working in this repository (Claude, Gemini or other).

1. Follow `CLAUDE.md`: its rules are not specific to one tool. In particular, every change goes through a PR from a `task/<id>` branch into `main`, CI is the judge, and the owner merges unless `CLAUDE.md` says otherwise.
2. `docs/HANDOVER.md` is the project guide (goal, owner's decisions, code map, how to work); `docs/BACKLOG.md` is the ordered list of tasks. Take the first task under "Ready".
3. Owner rulings are in `docs/RULES-DECISIONS.md` and are final.

Before opening a PR: `pnpm format` and `pnpm check` pass, plus the tests your change touches. CI runs the full simulation and e2e suites.
