# Handover

Written 2026-11-10 so that another coding agent (or a person) can pick this project up cold. Everything described as done is on the branch `ccr-badc8dc5-cnbda7` of `RodMal/Aos-mobile`, which is also the repository's default branch.

## The goal

The owner wants to play a full game of Warhammer Age of Sigmar 4th edition (General's Handbook 2026-27) on a phone against a hard computer opponent. First matchup: their Sylvaneth list against their Seraphon list. Other factions come later. Their instruction: **make it playable first.**

Three earlier attempts failed by perfecting one layer (data, deployment, rules) without ever reaching a playable game. `docs/PRIOR-ATTEMPTS.md` explains what went wrong and what was reused. Do not repeat it: every milestone must end with something the owner can play on their phone.

## Decisions the owner has made

| Topic      | Decision                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosting    | GitHub Pages, public repo. Live at `https://rodmal.github.io/Aos-mobile/`. Every push to the branch deploys.                                                                                                                   |
| Army lists | Both supplied by the owner and encoded in `src/data/lists.ts`: Sylvaneth "Lords of the Clan" (player 0) and Seraphon "Sunclaw Starhost" (player 1). Only the rules on these two lists are in scope until the hard NPC is done. |
| Movement   | Drag the whole unit with automatic formation, plus per-model adjustment. Both exist.                                                                                                                                           |
| Rules text | Unit cards show the full ability text from the BSData data.                                                                                                                                                                    |
| Rulings    | A hit roll of 6 is a critical hit only for a weapon with a Crit ability. All-out Attack is +1 to hit only. Both are in the code and in `docs/RULES-DECISIONS.md` (I6, I19).                                                    |
| Process    | Keep it light. Parallel subagents are welcome; in Claude sessions, use the smaller models for subagents where they suffice.                                                                                                    |

## Where the project stands

**Done, tested and deployed (commit `f752473`):**

- **M0–M1:** scaffold, data, geometry, touch board (pinch, pan, select, roster, unit cards), the move flow.
- **M2:** a full five-round game against a baseline NPC: priority roll, command points, move, run, retreat, shoot, charge (roll then place), alternating fights with pile-in, casualties, objective control, Into the Fire scoring, four commands (Rally, At the Double, All-out Attack, All-out Defence), per-model weapon loadouts, undo, save and resume.
- **Offline install** (PWA with a service worker).
- **Checks at this commit:** 308 unit tests, 30 Playwright tests at phone sizes (including a whole game played through the touch UI and a charge placed and fought), NPC-vs-NPC simulations with invariants after every action. CI runs all of it on every push.

**Not yet tried by the owner on a real phone.** Their feedback on the first session should take priority over new features.

**In progress when this was written, and NOT on the remote:** milestone M3a (below) was being built by a subagent in a local worktree. If you do not see `src/engine/abilities/` in the repository, that work was lost and M3a starts from scratch.

## What comes next, in order

### M3a: ability framework, magic, remaining commands (vertical slice: engine + NPC + UI)

1. **Ability framework** in `src/engine/abilities/`: one hand-written definition per ability, keyed by the BSData ability id in `data/`. A definition can have modifiers (evaluated with the attack in context: attacker, target, weapon, mode), grants (ward, keywords such as strike-first, permissions), triggers at timing windows, activated abilities (timing, cost or roll, target spec, `canUse`, `resolve`), reactions, and timed effects stored as plain data. Move the hard-wired command effects in `src/rules/core/modifiers.ts` onto it. Add a guard test that every registered id exists in the data under the expected name.
2. **Magic:** casting rolls, miscasts, power level from `UnitProfile.wizard`/`priest`, once-per-turn limits, Unbind as a reaction, chanting and ritual points, summoning manifestations as units (profiles from `data/factions/universal.json`), manifestations moving with their controller, Banish Manifestation.
3. **First content:** Lore of the Deepwood (3 spells), Lore of the Spirit-Song (3 prayers), Lore of Celestial Manipulation (3 spells), the summon abilities of Aetherwrought Machineries and Morbid Conjuration, and the six remaining commands (Forward to Victory, Redeploy, Counter-charge, Covering Fire, Magical Intervention, Power Through). One test each.
4. **Strike-first / strike-last** in the fight order.
5. **NPC** uses the new abilities in a simple way.
6. **UI:** every new option and decision reachable by touch; extend `minimalPlayerStep` in `tests/e2e/helpers.ts` so the full-game e2e test still finishes.

### M3b: the rest of the core rules

Terrain rules (cover, obscuring and line of sight, unstable, Places of Power), Guarded Hero, Fly along paths, battle tactics for the four cards in play (Flanking Firestorm, Burning for Vengeance, Siege of Ashes, Legend of the Parch) with their selection flow, the season rules (Fury), Into the Fire's battleplan abilities (Secure the Gateway, Determined Defenders), and real alternating deployment with an NPC that deploys. Each removes a line from the "Simplifications" table in `docs/RULES-DECISIONS.md`.

### M4: every rule on both lists (about 90 abilities)

- **Sylvaneth:** 6 battle traits (build the "creeping overgrowth" mechanic first; about a third of the rest depend on it), the formation ability Nature's Titans, Realmroot Guide, Glamourweave, Aspect of Heartwood, the three Aetherwrought Machineries manifestations' own abilities, and the warscrolls of Alarielle the Everqueen, Belthanos, Spirit of Durthu, Drycha Hamadreth (the 250-point one), Spite-Revenants, Warsong Revenant, Dryads and the Awakened Wyldwood (faction terrain).
- **Seraphon:** 6 battle traits, Vengeance of Azyr, Beastmaster, Coatl Familiar, Armour Cruncher, the four Morbid Conjuration manifestations' abilities, and the warscrolls of Lord Kroak, Kroxigor, Sunblood Pack, Saurus Guard, Saurus Astrolith Bearer, Saurus Warriors, Skink Starseer, Bastiladon with Ark of Sotek, Hunters of Huanchi with Dartpipes and the Realmshaper Engine (faction terrain).

One test per ability. List every interpretation in `docs/RULES-DECISIONS.md` for the owner to check.

### M5: the hard NPC

Replace `src/ai/baseline.ts` as the top difficulty with a planner: expected-damage and threat-range features; role-aware intents per unit (hold, contest, screen, stage, charge, shoot, retreat); a turn-level plan valuing victory points now and next turn, trades and exposure (including the double turn); then a bounded search that plays the best few plans across sampled dice against a baseline reply, in the Web Worker with a time budget. The NPC must not see future dice. Measure strength with seeded self-play in mirrored pairs (`scripts/selfplay.ts`, to be written): target Medium beats baseline 65% and Hard beats Medium 60% over 200 pairs. Three difficulty levels in the menu.

### M6

More battleplans (the map data for all twelve is in the owner's `BSData-parser` repo), list import, more units, a data refresh.

## How the code is organised

Read `docs/ARCHITECTURE.md` first. In short:

| Path                                                                 | What it is                                                                                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/types.ts`                                                | **The contract** between engine, UI and NPC: `GameState`, `Decision`, `Action`, `GameEvent`, `Engine`. Change it additively.                                                   |
| `src/engine/engine.ts`                                               | The decision loop: `decision`, `unitOptions`, `targetOptions`, `checkPlacement`, `apply`, `defaultAction`. `apply` clones the state once and mutates the clone.                |
| `src/engine/{attack,combat,damage,movement,expected,query,setup}.ts` | Attack sequence, target options, casualties, placement legality, expected damage, read-only queries, automatic set-up.                                                         |
| `src/rules/core`, `src/rules/battleplans`                            | Commands, modifiers, rally, objectives, round rules, Into the Fire scoring.                                                                                                    |
| `src/ai/baseline.ts`, `src/ai/placement.ts`                          | The current opponent and helpers that build legal move, charge and pile-in placements.                                                                                         |
| `src/game.ts`                                                        | The one scenario and engine the app plays; shared by the UI and the worker.                                                                                                    |
| `src/worker/npc.worker.ts`, `src/ui/npc/npcClient.ts`                | The NPC in a Web Worker with a main-thread fallback.                                                                                                                           |
| `src/ui`                                                             | React app: `board/` (SVG, view maths, gestures, hit testing), `sheet/` (decision, unit, place and attack panels), `prompts/`, `drawers/`, `game/` (stores, actions, log text). |
| `src/data`                                                           | zod schemas, `UnitProfile` parsing, army lists, battlefield. `data/` holds the JSON; see `data/SOURCE.md`.                                                                     |
| `src/geom`                                                           | Bases, distances, coherency, formations, in inches.                                                                                                                            |
| `tests/sim`, `tests/e2e`                                             | Full-game simulations; Playwright at phone sizes.                                                                                                                              |

The engine is deterministic and decision-driven: a game is a scenario, a seed and a list of actions. The core (`src/geom`, `engine`, `rules`, `ai`, `data`) takes no DOM, React, `Math.random` or `Date.now`; ESLint and a DOM-free tsconfig enforce it.

## Working on it

```sh
pnpm install
pnpm check                  # lint, typecheck, unit tests
SIM_SEEDS=200 pnpm test:sim # full games with invariants
pnpm test:e2e -- --trace off
pnpm format
pnpm dev                    # http://localhost:5173
```

Things that cost time before:

- **Stale preview server.** Playwright reuses whatever is listening on port 4173. Stop it first with `pkill -f "vite.js preview"` (the pattern `vite preview` does not match the process), or the tests run against an old build.
- **Formatting is checked in CI.** Run `pnpm format` before committing.
- **Deploys** happen on every push to the branch. Do not push a state where `pnpm check` or the e2e suite fails; the owner plays the deployed version.
- **The service worker** applies a new deploy on the visit after it downloads, so the owner may need to open the app twice to see a change.
- **Agent worktrees** live under `.claude/worktrees/` and are ignored by git and ESLint.
- **Porting sources.** Rule logic and test cases were ported from the owner's earlier repos, which a new session can clone: `RodMal/aos-webapp` (`packages/game-engine/src/rules/`: spells, prayers, manifestations, commands, combatPhase, battleTactics, fury, terrain), `RodMal/BSData-parser` (data, geometry, maps, deployment reducer and deployment NPC), `RodMal/aos-guru` (expected-damage maths). Port logic and test cases; do not copy `aos-webapp`'s state model, global RNG or its regex-generated ability effects.
- **Rules.** Never generate behaviour from ability text. Do not fetch rules from the web; where unsure, record the reading in `docs/RULES-DECISIONS.md` and ask the owner, who is a tournament player.
- **Git.** Conventional commits, never force-push, work on `ccr-badc8dc5-cnbda7`. Do not open a pull request unless the owner asks.

## Known gaps in what is deployed

- No magic, abilities, battle tactics or faction rules yet: heroes are stat blocks.
- No line of sight or cover; deployment is automatic; paths are straight lines (see the Simplifications table).
- UI: the top bar shows whose turn it is, not whose decision it is, so it can say "Seraphon turn" while the owner is choosing a unit to fight. In Adjust mode a model is tapped and then dragged from anywhere, not dragged directly. While placing a unit, one finger moves the unit and two fingers pan.
- Not verified on real hardware: iOS Safari install, Android launcher icon, and general feel on a phone.
