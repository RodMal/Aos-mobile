# Handover

Written 2026-11-10 so that another coding agent (or a person) can pick this project up cold. Everything described as done is on the branch `ccr-badc8dc5-cnbda7` of `RodMal/Aos-mobile`, which is also the repository's default branch.

## The goal

The owner wants to play a full game of Warhammer Age of Sigmar 4th edition (General's Handbook 2026-27) on a phone or a desktop browser against a hard computer opponent. First matchup: their Sylvaneth list against their Seraphon list. Other factions come later. Their instruction: **make it playable first.**

Three earlier attempts failed by perfecting one layer (data, deployment, rules) without ever reaching a playable game. `docs/PRIOR-ATTEMPTS.md` explains what went wrong and what was reused. Do not repeat it: every milestone must end with something the owner can play on their phone.

## Decisions the owner has made

| Topic      | Decision                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting    | GitHub Pages, public repo. Live at `https://rodmal.github.io/Aos-mobile/`. Every push to the branch deploys.                                                                                                                                                                                                                                |
| Army lists | Both supplied by the owner and encoded in `src/data/lists.ts`: Sylvaneth "Lords of the Clan" (player 0) and Seraphon "Sunclaw Starhost" (player 1). Only the rules on these two lists are in scope until the hard NPC is done.                                                                                                              |
| Movement   | Drag the whole unit with automatic formation, plus per-model adjustment. Both exist.                                                                                                                                                                                                                                                        |
| Rules text | Unit cards show the full ability text from the BSData data.                                                                                                                                                                                                                                                                                 |
| Devices    | Phone and desktop are both targets (decided 2026-11-11). One code path: CSS adapts the layout, and the flows are the same. Every UI change is checked on both: the phone projects and the `desktop` Playwright project (1280x800, mouse, wheel, keyboard), plus the screenshots in `docs/screenshots/phone` and `docs/screenshots/desktop`. |
| Rulings    | A hit roll of 6 is a critical hit only for a weapon with a Crit ability. All-out Attack is +1 to hit only. Both are in the code and in `docs/RULES-DECISIONS.md` (I6, I19).                                                                                                                                                                 |
| Process    | Keep it light. Parallel subagents are welcome; in Claude sessions, use the smaller models for subagents where they suffice.                                                                                                                                                                                                                 |

## Where the project stands

**Done, tested and deployed (commit `f752473`):**

- **M0–M1:** scaffold, data, geometry, touch board (pinch, pan, select, roster, unit cards), the move flow.
- **M2:** a full five-round game against a baseline NPC: priority roll, command points, move, run, retreat, shoot, charge (roll then place), alternating fights with pile-in, casualties, objective control, Into the Fire scoring, four commands (Rally, At the Double, All-out Attack, All-out Defence), per-model weapon loadouts, undo, save and resume.
- **Offline install** (PWA with a service worker).
- **M3a (ability framework, magic & prayers, manifestations, all 10 commands, strike order):**
  - Ability framework in `src/engine/abilities/` (`types.ts`, `effects.ts`, `commands.ts`, `lores.ts`, `magic.ts`) with BSData ID guard tests (`registry.test.ts`).
  - Casting, miscasts, power level, Rule of One vs `UNLIMITED` and `repeatSameUnit`, `Unbind` reactions, chanting and ritual points, `Banish Manifestation`, summoning and moving manifestations from `Aetherwrought Machineries` and `Morbid Conjuration`.
  - Lore of the Deepwood (3 spells), Lore of the Spirit-Song (3 prayers), Lore of Celestial Manipulation (3 spells), all 4 wizard warscroll spells on both lists (`Metamorphosis`, `Enrage The Spites`, `Celestial Deliverance`, `Celestial Doom`), all 7 manifestation summons, all 6 remaining commands (`Forward to Victory`, `Redeploy`, `Counter-charge`, `Covering Fire`, `Magical Intervention`, `Power Through`), and `STRIKE-FIRST` / `STRIKE-LAST` fight tiers.
  - Baseline NPC and touch UI updated for all M3a abilities, reactions and commands.
- **M3b (deployment, terrain traits, line of sight, guarded hero, path blocking, fury season, battle tactics):**
  - Alternating deployment (`src/engine/deployment.ts`) for faction terrain and regiments, with NPC deployment placement (`npcDeployPlacement`).
  - Terrain rules (`src/engine/terrain.ts`): cover (-1 to hit), obscuring / line of sight (halved ranged weapon range, models obscured wholly within 1" or behind footprint), unstable (cannot end moves on it), Places of Power boons (channelled wrath, ignite fury).
  - Guarded Hero: -1 to hit from shooting; infantry guarded hero cannot be targeted beyond 12".
  - Movement path blocking: non-FLY models cannot move across other units' bases.
  - GHB 2026-27 Fury Season rules (`src/rules/core/fury.ts`): Raising the Heat (attacker 1, defender 2), Simmering Rage (mandatory round start rage dice = fury level), Eruption of Fury (spend up to 3 rage dice, 6s do D3 mortal damage to all engaged enemies and +1 opponent fury; 1s do D3 mortal to self; no crits), Fight Through the Pain (spend rage dice to lower fury by 1 and negate damage on 3+).
  - Battle Tactics (`src/rules/core/battleTactics.ts`): 4 cards in play (5 VP each for Affray -> Strike -> Domination tier; cannot score on a turn when player seized initiative).
  - Into the Fire twists (`src/rules/battleplans/index.ts`): Secure the Gateway (Anti-charge +1 Rend when controlling Place of Power and contesting controlled objective), Determined Defenders (+3 control when underdog and wholly outside enemy territory).

**Not yet tried by the owner on a real phone.** Their feedback on the first session should take priority over new features.

## What comes next, in order

### M4: every rule on both lists (about 90 abilities)

- **Sylvaneth:** 6 battle traits (build the "creeping overgrowth" mechanic first — including start-of-round **Endless Growth** spreading overgrown tokens and start-of-turn **Creeping Dread** — as about a third of the rest depend on it), the formation ability Nature's Titans, Realmroot Guide, Glamourweave, Aspect of Heartwood, the three Aetherwrought Machineries manifestations' own abilities, and the warscrolls of Alarielle the Everqueen (including her start-of-round / start-of-turn abilities), Belthanos, Spirit of Durthu, Drycha Hamadreth (the 250-point one), Spite-Revenants, Warsong Revenant, Dryads and the Awakened Wyldwood (faction terrain).
- **Seraphon:** 6 battle traits (including start-of-round / start-of-turn Asterisms), Vengeance of Azyr, Beastmaster, Coatl Familiar, Armour Cruncher, the four Morbid Conjuration manifestations' abilities, and the warscrolls of Lord Kroak, Kroxigor, Sunblood Pack, Saurus Guard, Saurus Astrolith Bearer, Saurus Warriors, Skink Starseer, Bastiladon with Ark of Sotek, Hunters of Huanchi with Dartpipes and the Realmshaper Engine (faction terrain).

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
| `tests/sim`, `tests/e2e`                                             | Full-game simulations; Playwright on two phones and a desktop.                                                                                                                 |

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
- **Desktop UI.** From 820px wide the sheet sits beside the board; when the board is wider than tall the table is shown flat (enemy to the right) instead of turned bottom-up as on a phone. Escape closes the topmost panel, drawer or dialog; Enter confirms a placement, an ability or a roll (never a phase). The `desktop` project reuses the phone specs through `drag`/`tapAt`/`ahead` in `tests/e2e/helpers.ts`; touch-only specs skip themselves and `tests/e2e/desktop.spec.ts` holds the mouse-only ones.
- **Screenshots.** `SHOTS=docs/screenshots SHOTS_DSF=1 pnpm exec playwright test screenshots --project=pixel-7 --project=desktop` writes `phone/` and `desktop/` (add `SHOTS_VIEWPORT=1920x1080` to look at a bigger window). `--project` takes the file filter first, not after.
- **Formatting is checked in CI.** Run `pnpm format` before committing.
- **Deploys** happen on every push to the branch. Do not push a state where `pnpm check` or the e2e suite fails; the owner plays the deployed version.
- **The service worker** applies a new deploy on the visit after it downloads, so the owner may need to open the app twice to see a change.
- **Agent worktrees** live under `.claude/worktrees/` and are ignored by git and ESLint.
- **Porting sources.** Rule logic and test cases were ported from the owner's earlier repos, which a new session can clone: `RodMal/aos-webapp` (`packages/game-engine/src/rules/`: spells, prayers, manifestations, commands, combatPhase, battleTactics, fury, terrain), `RodMal/BSData-parser` (data, geometry, maps, deployment reducer and deployment NPC), `RodMal/aos-guru` (expected-damage maths). Port logic and test cases; do not copy `aos-webapp`'s state model, global RNG or its regex-generated ability effects.
- **Rules.** Never generate behaviour from ability text. Do not fetch rules from the web; where unsure, record the reading in `docs/RULES-DECISIONS.md` and ask the owner, who is a tournament player.
- **Git.** Conventional commits, never force-push, work on `ccr-badc8dc5-cnbda7`. Do not open a pull request unless the owner asks.

## Known gaps in what is deployed

- Faction battle traits and warscroll abilities (about 90 abilities) are queued for M4: heroes currently rely on their profile stats, weapons, spells/prayers, commands, and season rules.
- Start-of-round and start-of-turn faction mechanics (Sylvaneth Creeping Overgrowth / Endless Growth, Creeping Dread, Seraphon Asterisms, Alarielle's Seasons) are scheduled for M4.
- UI: the top bar shows whose turn it is, not whose decision it is, so it can say "Seraphon turn" while the owner is choosing a unit to fight. In Adjust mode a model is tapped and then dragged from anywhere, not dragged directly. While placing a unit, one finger moves the unit and two fingers pan.
- Not verified on real hardware: iOS Safari install, Android launcher icon, and general feel on a phone.

## State on 2026-11-11 (branch `worktree-agent-a2413e19c5eccdf72`)

This branch is **not merged** into `ccr-badc8dc5-cnbda7` and **not pushed**. Before merging, `pnpm check`, the full simulation (`SIM_SEEDS=60 pnpm test:sim`) and `pnpm test:e2e` must all pass; on the last commit only `pnpm check` was run in full (a 10-seed simulation passed after the faction terrain commit).

Done (review findings and owner rulings):

- 9d9e0cf actions rejected for units the deciding player does not own; dec2bcb unknown units throw `IllegalActionError`.
- fde50e2 and d3d21c6 All-out Attack: +1 to hit only for the attacks it was bought for; -1 to the unit's save rolls until the end of the turn (owner's correction).
- b0b912e Endless Growth (both options, Nature's Titans).
- 7151d56 one creeping overgrowth implementation (`src/engine/overgrowth.ts`): per-player tokens, 6/9/12"/whole battlefield, "wholly within" where printed, only Awakened Wyldwoods spread tokens (Ever Growing: closest feature without a token, unless the opponent controls it).
- 263b3d6 quick-start games set up both armies' faction terrain.
- b479957 faction terrain never acts (no options, actions rejected), cannot be charged, is not a shooting target, creates no combat range; units within 3" may attack it in the combat phase and may decline.
- 63e06d3 footprints: Wyldwood outlines traced from the owner's template (three different pieces in `src/data/wyldwood.ts`; piece 1 used), Realmshaper Engine a 6" square; concave outlines use the general polygon routines (`Footprint` kind `polygon`).

Remaining, with the owner's rulings in full:

- **B Place of Power**: usable at the start of each turn by both players (active player first); once per turn per army; needs only a friendly hero within 3" of a Place of Power (no control, combat does not matter); only the owner activates their hero; not accepted in other phases. Make Channelled Wrath (+1 casting and chanting) and Dizzying Rage (unbind or banish once) work; backfire D3 mortal damage is warded (I36); NPC picks a boon that helps the hero. Work in progress saved outside the repo; it broke ~46 tests that expect no start-of-turn prompt in quick-start games (Spirit of Durthu and Lord Kroak deploy within 3" of a spire), so tests need a helper that passes those prompts.
- **D** Song Of The Lost on 8+: ignores the attacker's Rend and positive save modifiers such as All-out Defence, in attacks and expected damage.
- **E** Song Of Dread triggers on charge moves and Power Through moves, not pile-ins (an ability counts if it has the Move keyword).
- **F** Power Through: after the D3 the unit moves; it may not enter combat with a unit it was not already in combat with; it may stay in or leave combat.
- **G** Round 1: whoever finished deploying first chooses who takes the first turn (quick start: the attacker), raised as the `priority` decision; stop hard-coding player 0 in `initFury` and the first-turn code.
- **H** Battle tactics: both cards can advance in the same turn, 5 VP per tier; none after a double turn unless behind by 11 or more VP; tests for the untested tiers.
- **I** Covering Fire shooting phase only, not in combat, not after running; Magical Intervention also offers Banish; remove invented reaction filters unless the earlier engine cites text.
- **J** Guarded Hero: the Health 10 and 3-model bodyguard conditions are invented; use the plain wording from the earlier engine and record it as awaiting confirmation.
- **K** Set-up on terrain allowed where it is no higher than 1" (ruins and outcrops low enough, spires too tall; assumption).
- **L** Deployment robustness (`allowance: Infinity`, no illegal NPC placement fallback, JSON round-trip invariant in every phase).
- **M** Eruption of Fury: the player chooses how many rage dice (1 to the maximum) and the target/weapon; Fight Through the Pain as a visible prompt (reaction mechanism) with an NPC policy, answered in `tests/e2e/helpers.ts` `minimalPlayerStep`.
- **N** Creeping Dread and Seasons Of War are not wired (I37 overstates them).
- **O** Replace empty tests (`terrain.test.ts` Place of Power, `fury.test.ts`); restore `ReactionOption.command` as required.
- Hero-phase Wyldwood pieces: one more piece in each Sylvaneth hero phase up to three (pieces 2 and 3 outlines are ready); the data text has no set-up rule for them.
- Battle-tactics tracker in the UI; Burning for Vengeance asking the player to pick the fugitive.

### Progress on 2026-11-12 (branch `worktree-agent-adc66541dd62f3aa5`, items numbered as in the owner's list)

Done:

- 1 Battle tactics tracker: a pip per tier for both sides in the top bar (`tactics-button`, "Tactics" label on desktop); one tap opens the tracker drawer (`src/ui/drawers/TacticsDrawer.tsx`, rows from `src/ui/game/tactics.ts`) with each card, completed/next tiers, the next tier's printed condition and the fugitive. e2e `tests/e2e/tactics.spec.ts` on all projects.
- 2 Burning for Vengeance: a `fugitive` decision before the first turn (prompt `data-testid="fugitive"`, NPC/default picks the Hero with the fewest effective wounds); I41. The other three cards print no pre-battle choice. Quick-start games now open with this prompt: engine tests start with `startGame(engine, seed)` from `src/engine/test-helpers.ts` and e2e tests with `startGame`/`answerPreBattle` in `tests/e2e/helpers.ts`, which answer pre-battle prompts by default. Tests: `battleTactics.test.ts` "Burning for Vengeance fugitive", e2e "Burning for Vengeance asks the player to pick the fugitive".
- 3 Tactics scoring verified (already correct): both cards in one turn, 5 VP each, none on a chosen double turn unless behind by 11+; I42. Tests: `turn.test.ts` "battle tactics scoring".
- 4 Eruption of Fury: `rageDice` and `weaponId` on the `ability` action, `maxRageDice`/`weapons` on its option; stepper and weapon chips in the ability panel; NPC `eruptionAction` in `src/ai/baseline.ts`; I43. Tests: `src/engine/eruption.test.ts`, e2e `tests/e2e/fury.spec.ts`. New e2e mechanism: `tests/e2e/positions.ts` `openPosition` lets the NPC play both sides in the page (`?e2e=1` loads `src/ui/testHooks.ts`) until a condition holds and opens that game as a saved game.
- 5 Fight Through the Pain: attack damage is allocated through an `allocate` frame (`src/engine/combat.ts` `allocatePending`); the target's owner gets a reaction prompt with the incoming damage and a dice stepper (`PainPrompt` in `src/ui/prompts/Prompts.tsx`, "Take the damage" = pass, answered by `minimalPlayerStep`); NPC `painAction`; I44. Not yet offered for mortal damage outside attacks. Tests: `src/engine/fury-pain.test.ts`, e2e `tests/e2e/fury.spec.ts`. Unit tests that are not about rage set `rageDice = 0` in their arenas.
- 6 Place of Power per the owner's ruling (the saved patch applied, plus the default action passing and an NPC that picks a useful boon); I45. Tests: `terrain.test.ts` "Place of Power (owner ruling, 2026-11-11)", e2e `tests/e2e/fury.spec.ts` "Place of Power". Engine tests start with `startGame` (passes the optional prompt); e2e helpers pass it too. The e2e charge test now starts from an NPC-played position (`openPosition`).

Remaining: items 7 to 17 of the owner's list (hero-phase Wyldwoods, Song Of The Lost/Dread, Power Through, first-turn choice, reaction filters, Guarded Hero, set-up on terrain, Creeping Dread and Seasons Of War, declined faction-terrain attacks, deployment robustness).
