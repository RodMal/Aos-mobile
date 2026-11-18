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

### B1 Answered prayers can't be banked

- **Tier**: sonnet+review
- **Touches**: rules, engine, ui/prompts, ai
- **Owner's report**: "Prayers are not giving me the option to bank them when answered."
- **Read**: the chanting and ritual points rules in `data/ruleset.json` (core rules), `src/engine/abilities/magic.ts` (chanting), the prayer prompt in `src/ui/prompts/`, `src/ai/baseline.ts`
- **Done when**: when a chanting roll answers a prayer, the player is offered the choice the core rules give (use the prayer now, or bank the roll as ritual points) exactly as printed, and banked points carry over and count toward later chants as printed. The NPC makes the choice deterministically. There are tests for answering, banking, and using banked points; the prompt is checked on phone and desktop; the reading is recorded in `docs/RULES-DECISIONS.md`; and old saves stay replayable.

### S1 Version saved games so a rules change offers a fresh game instead of silently diverging

- **Tier**: sonnet
- **Touches**: ui/game, engine
- **Read**: `src/ui/game/session.ts` (`toRecord`, `replay`), `src/ui/game/store.ts`, I70 and I84 in `docs/RULES-DECISIONS.md`
- **Done when**: `GameRecord` carries a rules version that is bumped whenever a change alters how recorded actions replay. On load, a record with an older version, or one whose replay throws, shows a short notice ("This saved game is from an older version — start a new game?") instead of silently starting fresh or diverging. There are tests for both paths, and the version bump is documented in `docs/HANDOVER.md`.

### M4d Sylvaneth passives: wards, movement, Battle Damaged, Glamourweave

- **Tier**: sonnet+review
- **Touches**: engine, rules
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/sylvaneth.json` (Alarielle `135b-afc5-4fd9-3460`, Belthanos `59e8-f376-a5df-144c` and `c6b8-a8fd-b2-59fa`, Spirit of Durthu `2eb1-9bd5-1544-36d9` and artefact Glamourweave `cafd-9cf1-871c-f47e`, Drycha `a1f-39fd-6570-f3d5`, Warsong Revenant `3f73-3ee4-8f6b-b16b`, Dryads `f62f-75b0-48cd-101e`); `src/engine/abilities/effects.ts` (`passiveGrants`, `unitGrants`), `src/engine/eligibility.ts` (move and run options), `src/rules/core/modifiers.ts`, `src/data/profile.ts` (weapon Attacks), `src/engine/overgrowth.ts` (`inCreepingOvergrowth`)
- **Done when**: one test per ability: Alarielle's Song (Ward 6+ for Sylvaneth within 12", -1 to enemy ward rolls within 12"), One With The Forest (-1 to hit and wound while wholly within the overgrowth), Terror Of The Deep Woods (enemies within 9" cannot Run or Retreat), Kurnothi War-horn (+2" Move), Battle Damaged on Alarielle, Belthanos and Spirit of Durthu (Attacks of the named weapon from 10 damage points), Glamourweave (one re-roll each of hit, wound and save per phase; the UI offers the re-roll). Update `docs/ABILITIES.md`.

### M4e Sylvaneth commands: Fury of The Forest, The Land Awakens, The Goddess Of Life

- **Tier**: sonnet+review
- **Touches**: engine, rules, ai, ui/prompts
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/sylvaneth.json` (Fury of The Forest `081a-ebf2-6a79-c4db`, The Land Awakens `dcad-fc9a-65a3-b46f`, The Goddess Of Life `4f7c-2ca1-ae3f-d2d3`); `src/rules/core/commands.ts` (the command table and `commandBlocker`; `CommandId` is in `src/engine/types.ts`, change it additively), `src/engine/commands.ts`, `src/engine/reactions.ts`, `src/engine/placing.ts` and `src/engine/damage.ts` (`returnPosition`, set-up of a unit), `src/engine/abilities/commands.ts`
- **Done when**: one test per ability: Fury of The Forest (Strike-first for the rest of the turn), The Land Awakens (a replacement unit with half the models, rounded up, set up wholly within the creeping overgrowth and more than 9" from enemies; say in `docs/RULES-DECISIONS.md` what happens to the target unit and the timing), The Goddess Of Life (a replacement unit with 8 damage points that wards cannot save, same set-up limits). Timing and cost of each follow the printed text; the commands appear in the command list only for the army that has them; the NPC does not need to use them.

### M4f Seraphon unit passives

- **Tier**: sonnet+review
- **Touches**: engine, rules
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/seraphon.json` (Kroxigor Brutal Blows `786b-b219-e23-42f8`; Sunblood Pack Starspawned `f571-744e-c103-8568`, Scaled Protectors `3ffa-e9b3-901b-8d06`, trait Beastmaster `5e50-d938-39d2-19a6`; Saurus Guard Selfless Protectors `e49d-3d7e-2eee-a5e0`; Saurus Astrolith Bearer Revivifying Energies `15e-ebba-9386-bd1a`; Saurus Warriors Ordered Cohorts `4181-bbd5-a4d8-1f59`); `src/engine/abilities/effects.ts` (`passiveGrants`), `src/rules/core/modifiers.ts` (`ignoreSaveModifiers` exists), `src/engine/damage.ts` (damage allocation), `src/engine/eligibility.ts` (move allowance), `src/rules/core/objectives.ts`
- **Done when**: one test per ability: Brutal Blows (+1 Damage against a unit of 10 or more models), Starspawned (the first damage point each phase is ignored, for Saurus and Kroxigor within 12"), Scaled Protectors (save modifiers ignored), Beastmaster (+2" Move for Cavalry and Monsters within 12" at the start of the move), Selfless Protectors (Ward 5+ for the unit and Slann within combat range), Revivifying Energies (Ward 6+ for Infantry within 12", 5+ if already 6+), Ordered Cohorts (+1 to save rolls while every model contests an objective you control). Update `docs/ABILITIES.md`.

### M4g Sylvaneth set-up and charge abilities: Huntmaster's Strike, Rhythm of the Chase, Merciless Ambush, Shadowcreep, Realmroot Guide, Guardian Of The Glades

- **Tier**: sonnet+review
- **Touches**: engine, ai, ui/prompts, ui/board
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/sylvaneth.json` (Belthanos `61d2-55e1-7873-e100`, `b29c-dd1a-502d-27c4`; Drycha `77b2-7e2-ba0c-83a1`; Spite-Revenants `76b2-ce61-8aec-f6c1`; Warsong Revenant trait Realmroot Guide `c133-8f0c-936d-30d3`; Spirit of Durthu `ea9f-5c5b-8b97-78aa`); `src/engine/placing.ts`, `src/engine/decisions.ts` (activated options and `place` decisions), `src/engine/engine.ts` (charge phase), `src/engine/overgrowth.ts`, `src/engine/wyldwood.ts` (a worked example of a set-up decision), RULES-DECISIONS I65
- **Done when**: one test per ability, each with the printed limits: Huntmaster's Strike (after a charge, re-set up more than 6" from enemies within the overgrowth), Rhythm of the Chase (D3 mortal damage on 2+, then re-set up within 1" of the target), Merciless Ambush (command; re-set up within 1/2" of an enemy and wholly within X" of a terrain feature with an overgrown token, X being the charge roll; the unit has charged), Shadowcreep (within the overgrowth, re-set up wholly within 3" of terrain and more than 9" from enemies, +1 to charge rolls), Realmroot Guide (the targets are re-set up wholly within the overgrowth and more than 9" from enemies), Guardian Of The Glades (+2 to the charge roll, must end within 1/2" of an enemy in combat with a friendly Sylvaneth Hero). The NPC may leave them unused.

### M4h Seraphon activated abilities

- **Tier**: sonnet+review
- **Touches**: engine, rules, ai, ui/prompts
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/seraphon.json` (Sunblood Pack Venomite Swarm `cf2e-d237-9320-1105`; Saurus Astrolith Bearer Celestial Conduit `153d-3737-615b-b904`; Skink Starseer Scry the Stars `b8a5-8e24-ad08-d213` and artefact Coatl Familiar `2302-6d4-c346-7bc6`; Bastiladon Ark of Sotek `714c-4cb6-fce8-6ef9` and trait Armour Cruncher `f6fe-3e8d-dd90-00b8`; Hunters of Huanchi Star-venom `c71d-2217-fcf1-6110`); `src/engine/decisions.ts` (activated options), `src/engine/abilities/magic.ts` (casting, for Coatl Familiar and Celestial Conduit), `src/rules/core/fury.ts` (rage dice and fury level, for Armour Cruncher), `src/rules/core/objectives.ts` (control score), `src/engine/abilities/lores.ts` (examples of mortal damage abilities)
- **Done when**: one test per ability: Venomite Swarm (the Venomites token and D3 mortal damage on 2+), Celestial Conduit (+3 control score within 12" after a successful cast), Scry the Stars (dice by the battle round number, Ward 5+ on each 3+ for a Seraphon unit wholly within 18"), Coatl Familiar (add D6 to the casting roll), Ark of Sotek (D3 per target, mortal damage on 2+), Armour Cruncher (rage dice, fury level raise or save roll, -1 to saves), Star-venom (2+: -1 to wound on the target's combat attacks). Update `docs/ABILITIES.md`.

### M4i Sylvaneth healing and other activated abilities

- **Tier**: sonnet+review
- **Touches**: engine, rules, ai, ui/prompts
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/sylvaneth.json` (Alarielle Lifebloom `e4b4-8e4d-5f0-eb6a` and Living Battering Ram `5abd-6507-dbee-ed76`; Spirit of Durthu Groundshaker `7124-769a-aafd-7b38`; Warsong Revenant Wyldwood Revenants `dc61-1f39-51f9-52da`; Dryads trait Aspect of Heartwood `0770-09a1-99c6-1a99`); `src/engine/damage.ts` (`healUnit`), `src/rules/factions/sylvaneth.ts` (`resolveEndlessGrowth`, which Aspect of Heartwood changes; M4n makes its effect a player choice), `src/engine/abilities/magic.ts` (chanting rolls, for the re-roll), `src/engine/decisions.ts`
- **Done when**: one test per ability: Lifebloom (Heal (2D6)), Living Battering Ram (3+: mortal damage equal to the roll), Groundshaker (3+: Strike-last on the target for the turn), Wyldwood Revenants (re-roll a chanting roll), Aspect of Heartwood (D6 instead of D3 for targets wholly within 12", Heal 6 instead of Heal 3, or return a slain model to a Kurnothi target). Update `docs/ABILITIES.md`.

### M4j Reserve and ambush: Hidden Hunters, Chameleon Ambush

- **Tier**: sonnet+review
- **Touches**: engine, ai, ui/prompts, ui/board
- **Read**: `docs/ABILITIES.md`; printed text in `data/factions/seraphon.json` (Hunters of Huanchi with Dartpipes: Hidden Hunters `c78e-71e9-a948-fb09`, Chameleon Ambush `4a89-1c50-df0e-4b2b`); `src/engine/deployment.ts` (units in `reserve`), `src/engine/placing.ts`, `src/engine/decisions.ts`, `src/engine/types.ts` (`UnitState.status`), the core rules on reserves in `data/ruleset.json`
- **Done when**: one test per ability: Hidden Hunters (the unit is set up in reserve in ambush and counts as deployed), Chameleon Ambush (set up anywhere more than 9" from enemy units, at the printed timing, with the other core reserve limits). Say in `docs/RULES-DECISIONS.md` how the NPC treats an enemy unit in reserve. Update `docs/ABILITIES.md`.

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
- Whether ruins and outcrops block standing (currently allowed under the 1" ruling: `LOW_TERRAIN_KINDS` in `src/data/battlefield.ts`), and moving across a spire.

## Later

- M5: the hard NPC (planner and bounded search in the worker, three difficulties, self-play measurement), as scoped in `docs/ROADMAP.md`.
- M6: more battleplans, list import, more units, data refresh.

## Done

History before the loop is in git and in `docs/RULES-DECISIONS.md`. Older entries are kept as history; new completions are the merged PRs (`<id>: <title>`), not lines here.

R1 — Redeploy timing, and Redeploy counts as a run
R2 — Free pile-in after a charge
