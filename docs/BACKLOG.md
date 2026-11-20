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

### R13 "Any phase" abilities in both turns

- **Tier**: sonnet+review
- **Touches**: engine, ai, ui/prompts
- **Read**: `docs/ABILITIES.md` (Sylvaneth and Seraphon "Any ... Phase" abilities); RULES-DECISIONS I106, I104 (owner ruling 2026-11-20 on Core 13.0); `src/engine/abilities/` (timing of Any-phase abilities), `src/engine/decisions.ts`, `src/ai/`
- **Ruling**: Owner ruling (2026-11-20), Core 13.0: "Any ... Phase" abilities are offered in both turns. In the opponent's turn they come after the active player has finished that phase. The NPC uses them only when they help (I108).
- **Done when**: every "Any Hero Phase", "Any Charge Phase" and "Any Combat Phase" ability is offered in the opponent's turn after the active player finishes, not only in the owner's own phase; one test per affected ability (offered in both turns, after the active player's phase, and not before it); the NPC answers when it helps; the full-game e2e passes on phone and desktop. Update I106 and `docs/ABILITIES.md`.

### R14 Groundshaker, Venomite Swarm and Ark of Sotek before fights

- **Tier**: sonnet+review
- **Touches**: engine, ai, ui/prompts
- **Read**: `docs/ABILITIES.md`; RULES-DECISIONS I104, I106, I107 and the owner ruling (2026-11-20) on Core 13.1; the start-of-combat reaction window for Rhythm of the Chase in `src/engine/` (combat phase and decisions); `src/ai/sylvaneth.ts`, `src/ai/seraphon.ts`
- **Ruling**: Owner ruling (2026-11-20), Core 13.1: non-FIGHT combat abilities are used before fighting starts. Groundshaker, Venomite Swarm and Ark of Sotek move from the fighter pick to the start-of-combat reaction window used by Rhythm of the Chase: the active player is offered first, then the defender. Once fighters are picked they cannot be used.
- **Done when**: one test per ability (offered in the start-of-combat window, active player first then defender, and resolved before any fighter is picked); a test that none of the three is offered during the fight pick; the NPC uses them only when they help. Update I104, I106 and `docs/ABILITIES.md`.

### R16 Climbing terrain costs movement

- **Tier**: sonnet+review
- **Touches**: engine, ui/board
- **Read**: RULES-DECISIONS I53, I57 and the owner ruling (2026-11-20) on Core 15.2; `src/engine/movement.ts`; terrain heights in `src/data/battlefield.ts`
- **Ruling**: Owner ruling (2026-11-20), Core 15.2: terrain 1" high or less is ignored. A model climbing taller terrain counts the vertical distance up and down toward its move, unless it has FLY.
- **Done when**: a model crossing a spire without FLY has the vertical climb (up and down) counted toward its move, and with FLY it does not; tests for both; other tall terrain is handled the same way; ruins and outcrops (1" or less) cost nothing. Update I57 and the terrain notes in `docs/ABILITIES.md` if present.

### R17 Venomites token as a tag

- **Tier**: sonnet
- **Touches**: engine, ui/prompts, ui/board, ai
- **Read**: RULES-DECISIONS I104 (point 4 and the Venomite Swarm entry) and the owner ruling (2026-11-20) that the token is not physical; `src/engine/` (the Venomites token and `tableSide`), `src/ui/prompts`, `src/ui/board`, `src/ai/`; the seraphon-r12 e2e test
- **Ruling**: Owner ruling (2026-11-20): the Venomites token is not physical. It is a tag on the Sunblood Pack unit, not a model placed on the board. There is no side choice and no board placement.
- **Done when**: the placed token, the side prompt from R12 and the board drawing are removed; `tableSide` is removed if nothing else uses it; the Sunblood Pack carries the tag; Venomite Swarm uses the tag (a roll of 1 removes it for good, then the ability is not offered); tests and the seraphon-r12 e2e are updated; the rules version is bumped. Update I104.

### R18 NPC thresholds: Merciless Ambush and Coatl Familiar

- **Tier**: sonnet
- **Touches**: ai
- **Read**: RULES-DECISIONS I103 (Merciless Ambush), I104 (Coatl Familiar) and the owner ruling (2026-11-20); `src/ai/sylvaneth.ts`, `src/ai/seraphon.ts`
- **Ruling**: Owner ruling (2026-11-20): the owner asked why the Merciless Ambush threshold is 6". It is not accepted and is replaced by a dice-based check. Coatl Familiar is used only when it helps the NPC.
- **Done when**: Merciless Ambush: for the best target, work out the charge roll X needed for a legal set-up within 1/2" of the enemy and wholly within X" of an overgrown terrain feature; use the ability only if P(2D6 >= X) is at least about 58% (X <= 7) and the NPC has spare CP. Coatl Familiar: use it only when it helps, e.g. when the extra D6 turns a likely failed cast into a likely success, or the spell matters. Both are deterministic and cheap, with tests for each threshold. Update I103 and I104.

### M4k Manifestation movement abilities: Scything Blade, The Pendulum Swings, End Given Form, Pulled to the Grave

- **Tier**: sonnet+review
- **Touches**: engine, ai, ui/board
- **Read**: `docs/ABILITIES.md`; printed text in the manifestation warscrolls of `data/lores.json` and `data/factions/*.json` (warscroll ids `fcb6-ae80-2e58-aadb` Aethervoid Pendulum: Scything Blade `54d0-e6a1-c6e8-46a7`, The Pendulum Swings `9ec5-1011-c05e-5045`; `e7a5-e611-4c13-22d0` Purple Sun of Shyish: End Given Form `42b5-c322-7e12-371c`; `1885-a1aa-bf5d-6d0d` Suffocating Gravetide: Pulled to the Grave `1fa3-5209-8869-8d58`); `src/engine/abilities/magic.ts` (summons, `manifestationUnitId`), `src/engine/movement.ts`, `src/engine/eligibility.ts`, `src/engine/damage.ts` (`applyMortalDamage`), RULES-DECISIONS S13, I24, I60
- **Done when**: one test per ability: moving through models, the units passed across found along the path, then Scything Blade (up to 3 enemy units passed across or within 1/2", D6 on 2+), End Given Form (up to 3 units passed across, D3 on 2+, cannot end in combat), Pulled to the Grave (a die per model in one passed-across unit, 5+ is 1 mortal damage, cannot end in combat), The Pendulum Swings (the move is a straight line along or against the blade; cannot charge or fight). The manifestation's own turn flow in the movement phase is offered on screen and to the NPC. Update S13 and `docs/ABILITIES.md`.

### M4l Other manifestation abilities

- **Tier**: sonnet+review
- **Touches**: engine, rules, ai
- **Read**: `docs/ABILITIES.md`; printed text in the manifestation warscrolls of `data/lores.json` (Chronomantic Cogs `1aba-bc38-e988-d79f`: Mechanisms of Time `ad92-932-6f56-1d97`; Quicksilver Swords `8cde-fafe-2b2a-ced5`: Dancing Blades `7b11-c623-fc14-4639`; Purple Sun: Pull of the Nadir `c99-9240-9da1-d029`; Malevolent Maelstrom `e699-49b7-d2b8-d5fc`: Morbid Detonation `b8a4-541-b62-cf62`, Necrotic Vortex `c711-ce6-1fb6-7abc`; Soulsnare Shackles `dee3-92a0-27e7-252a`: Bound for the Great Oubliette `6817-e507-443e-1ff4`, Multiple Parts `9e13-160b-4a87-da4e`); `src/engine/abilities/magic.ts`, `src/engine/abilities/effects.ts`, `src/engine/damage.ts`, `src/engine/turns.ts`, RULES-DECISIONS S13, I24
- **Done when**: one test per ability: Mechanisms of Time (a Wizard within 3" picks re-roll charges or -1 to hit against Wizards, within 12", until your next turn), Dancing Blades (no ward rolls against its damage), Pull of the Nadir (-1 to save rolls for every unit within 3"), Morbid Detonation (mortal damage on 2+, then destroyed), Necrotic Vortex (maelstrom points from set-up, successful casts within 12" and slain models within 12", maximum 6; they drive Morbid Detonation's target count per the printed text), Bound for the Great Oubliette (D3 mortal damage and Move reduced by the roll), Multiple Parts (three parts within 3" of each other, destroyed together). Update S13 and `docs/ABILITIES.md`.

### M4m Faction terrain abilities

- **Tier**: sonnet+review
- **Touches**: engine, rules, ai, ui/prompts
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/sylvaneth.json` (Awakened Wyldwood: Vengeful Forest Spirits `5dd6-a023-8cdb-5cb1`) and `data/factions/seraphon.json` (Realmshaper Engine: Fierce Guardians `bf4d-2061-b8d1-193`, Power Unleashed `aa75-204a-4256-8c68`); `src/engine/factionTerrain.test.ts`, `src/engine/wyldwood.ts`, `src/engine/eligibility.ts` (`isFactionTerrainUnit`; the terrain "never acts", I39), `src/rules/core/modifiers.ts`, RULES-DECISIONS I39, I40, I59
- **Ruling**: I39 is superseded by the owner's 2026-11-18 ruling (I74): each faction terrain piece's abilities work as its warscroll prints them.
- **Done when**: one test per ability: Vengeful Forest Spirits (D3 per target, mortal damage on 2+), Fierce Guardians (+1 to hit for Saurus and Kroxigor combat attacks against an enemy within 9" of the terrain), Power Unleashed (D3 per target on 2+, and D3 on the terrain if it has a Health characteristic). Say in `docs/RULES-DECISIONS.md` how I39 changes (the terrain acts through its abilities only, and still never moves or fights). Update `docs/ABILITIES.md`.

### M4n Gaps in what is already implemented: Endless Growth choice, tactic tiers

- **Tier**: sonnet
- **Touches**: engine, rules, ui/prompts
- **Read**: `docs/ABILITIES.md`; `src/rules/factions/sylvaneth.ts` (`resolveEndlessGrowth`, S7), `src/engine/decisions.ts`, printed text of Endless Growth `3ff5-8812-c55e-7f5a` in `data/factions/sylvaneth.json`; `src/rules/core/tactics/siegeOfAshes.ts` and `legendOfTheParch.ts`, `src/rules/core/battleTactics.test.ts`
- **Done when**: Endless Growth asks the player which effect to pick for each target (heal, or return models; the NPC keeps the automatic choice), with a test that each choice does what it says; tests for the Strike and Domination tiers of Siege of Ashes (Strike, and Domination: Repel the Attackers) and Legend of the Parch (Strike, and Domination: Hero of Legend), one per tier, each failing if the condition is changed. Update `docs/ABILITIES.md` and S7.

## Waiting on the owner

- The true size of the Awakened Wyldwood pieces: the traced outlines came out 6.6 to 8.5" long and 2.05 to 2.55" wide, below the owner's stated ranges. A real measurement of one piece fixes the scale (`src/data/wyldwood.ts`).
- Whether a model may end a move on a ruin or outcrop (currently allowed under the 1" ruling: `LOW_TERRAIN_KINDS` in `src/data/battlefield.ts`). Owner only.

## Later

- M5: the hard NPC (planner and bounded search in the worker, three difficulties, self-play measurement), as scoped in `docs/ROADMAP.md`.
- M6: more battleplans, list import, more units, data refresh.

## Done

History before the loop is in git and in `docs/RULES-DECISIONS.md`. Older entries are kept as history; new completions are the merged PRs (`<id>: <title>`), not lines here.

R1 — Redeploy timing, and Redeploy counts as a run
R2 — Free pile-in after a charge
