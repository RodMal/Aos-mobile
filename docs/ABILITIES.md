# Abilities on the owner's two lists

Audit of 2026-11-18 (task M4a, at `origin/main` 4e02d28). It covers every ability on the two lists in `src/data/lists.ts`: Sylvaneth **Lords of the Clan** and Seraphon **Sunclaw Starhost** (the Seraphon placeholder list is not audited). Rows are the abilities of the warscrolls, battle traits, formation, enhancements, spell lores, prayer lore, manifestation lores, the manifestations they summon and the faction terrain. Printed text is in `data/factions/{sylvaneth,seraphon}.json` and `data/lores.json`, found by the BSData id.

Status, judged from the code and the tests:

- **Implemented**: code exists and a test exercises it.
- **Partly**: code exists but a clause is missing or simplified (the gap is named).
- **Missing**: no code. The ability is on the warscroll data but the engine ignores it.

Abilities are looked up by id: spells, prayers and summons are registered in `src/engine/abilities/lores.ts`; the Sylvaneth battle traits live in `src/rules/factions/{sylvaneth,seasons}.ts` and `src/engine/{overgrowth,wyldwood}.ts`. No warscroll ability (passive, activated or command) other than those is read by the engine. Simplifications recorded in `docs/RULES-DECISIONS.md` are cited as S/I numbers.

Counts: **29 implemented, 5 partly, 60 missing** (94 rows). Ability-only counts, leaving out the four battle tactic cards: **27 implemented, 3 partly, 60 missing**.

The "Task" column names the backlog task that closes each gap.

## Sylvaneth: Lords of the Clan

### Battle traits, formation and faction terrain

| Ability                 | BSData id           | Status      | Evidence and gaps                                                                                                                                                      | Task |
| ----------------------- | ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| The Creeping Overgrowth | bf2f-f70a-be1e-4d63 | Implemented | `src/engine/overgrowth.test.ts` (range by token count, spells use it, shading); I37, I66, I68                                                                          |      |
| Endless Growth          | 3ff5-8812-c55e-7f5a | Partly      | `sylvaneth.test.ts`. The engine picks heal or return itself (S7); the player never chooses the effect                                                                  | M4n  |
| The Land Awakens        | dcad-fc9a-65a3-b46f | Missing     | Command: set up a replacement unit with half the models, wholly within the overgrowth and more than 9" from enemies                                                    | M4e  |
| Fury of The Forest      | 081a-ebf2-6a79-c4db | Missing     | Command: the unit has Strike-first for the rest of the turn. `STRIKE-FIRST` itself works (`magic.test.ts`); only the command is absent                                 | M4e  |
| Reclaimed By Nature     | cea9-4cb0-e5fb-bd3e | Implemented | `src/engine/wyldwood.test.ts` (limits, three-piece cap, NPC); I46, I61                                                                                                 |      |
| Creeping Dread          | c9cf-21d7-880d-e59f | Implemented | `seasons.test.ts` (offer, 3 targets under Everdusk, no Hero, +1 CP unless within 12" of a Hero); I54, I63. An unaffordable command is not offered rather than "wasted" |      |
| Nature's Titans         | 470d-dce9-5e70-29fb | Implemented | `sylvaneth.test.ts` (Heal 3 on a Monster, no roll)                                                                                                                     |      |
| Budding Forest          | 3885-ae8f-a0ed-7b62 | Implemented | `wyldwood.test.ts` ("carries its owner's overgrown token")                                                                                                             |      |
| Ever Growing            | 8c86-1655-c6c7-be0b | Implemented | `overgrowth.test.ts` (closest feature, enemy control, enemy faction terrain, per-Wyldwood Burgeoning); I66, I71, I73                                                   |      |
| Vengeful Forest Spirits | 5dd6-a023-8cdb-5cb1 | Missing     | Faction terrain never acts (I39, `factionTerrain.test.ts`); no mortal damage                                                                                           | M4m  |

### Warscrolls

| Ability                     | Unit                    | BSData id           | Status      | Evidence and gaps                                                                                            | Task |
| --------------------------- | ----------------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| Metamorphosis (spell)       | Alarielle the Everqueen | b4bf-ef71-9dfe-e837 | Implemented | `magic.test.ts` (token, splash, Fight Through the Pain); I29. Visibility is not checked (awaiting the owner) |      |
| Seasons Of War              | Alarielle the Everqueen | d584-62b7-8083-8f63 | Implemented | `seasons.test.ts` (never last round's, Reaping, Dwindling, Burgeoning per Wyldwood, Everdusk); I54, I71      |      |
| Battle Damaged              | Alarielle the Everqueen | 135b-afc5-4fd9-3460 | Missing     | Attacks of the Antlers should be 4 from 10 damage points                                                     | M4d  |
| Lifebloom                   | Alarielle the Everqueen | e4b4-8e4d-5f0-eb6a  | Missing     | Heal (2D6) this unit                                                                                         | M4i  |
| Living Battering Ram        | Alarielle the Everqueen | 5abd-6507-dbee-ed76 | Missing     | D6 roll, on 3+ mortal damage equal to the roll                                                               | M4i  |
| The Goddess Of Life         | Alarielle the Everqueen | 4f7c-2ca1-ae3f-d2d3 | Missing     | Command: replacement unit with 8 damage, no wards on them                                                    | M4e  |
| Huntmaster's Strike         | Belthanos               | 61d2-55e1-7873-e100 | Missing     | After a charge, re-set up more than 6" from enemies within the overgrowth                                    | M4g  |
| Kurnothi War-horn           | Belthanos               | 59e8-f376-a5df-144c | Missing     | +2" Move to Kurnothi wholly within 12"                                                                       | M4d  |
| Rhythm of the Chase         | Belthanos               | b29c-dd1a-502d-27c4 | Missing     | D3 mortal damage on 2+, then re-set up within 1" of the target                                               | M4g  |
| Battle Damaged              | Belthanos               | c6b8-a8fd-b2-59fa   | Missing     | Mandibles Attacks 3 from 10 damage points                                                                    | M4d  |
| Groundshaker                | Spirit of Durthu        | 7124-769a-aafd-7b38 | Missing     | 3+: target has Strike-last for the turn                                                                      | M4i  |
| Battle Damaged              | Spirit of Durthu        | 2eb1-9bd5-1544-36d9 | Missing     | Guardian Sword Attacks 3 from 10 damage points                                                               | M4d  |
| Guardian Of The Glades      | Spirit of Durthu        | ea9f-5c5b-8b97-78aa | Missing     | +2 to a charge roll with an end-of-charge condition                                                          | M4g  |
| Glamourweave (artefact)     | Spirit of Durthu        | cafd-9cf1-871c-f47e | Missing     | One re-roll each of hit, wound and save per phase                                                            | M4d  |
| Terror Of The Deep Woods    | Drycha Hamadreth        | a1f-39fd-6570-f3d5  | Missing     | Enemies within 9" cannot Run or Retreat                                                                      | M4d  |
| Enrage The Spites (spell)   | Drycha Hamadreth        | a924-fd6e-9278-4d4c | Implemented | `magic.test.ts` (up to 3 picked targets, overgrowth, NPC); I62                                               |      |
| Merciless Ambush            | Drycha Hamadreth        | 77b2-7e2-ba0c-83a1  | Missing     | Command: re-set up within 1/2" of an enemy as a charge                                                       | M4g  |
| Shadowcreep                 | Spite-Revenants         | 76b2-ce61-8aec-f6c1 | Missing     | Re-set up within 3" of terrain, then +1 to charge rolls                                                      | M4g  |
| Wyldwood Revenants          | Warsong Revenant        | dc61-1f39-51f9-52da | Missing     | Re-roll a chanting roll                                                                                      | M4i  |
| Alarielle's Song            | Warsong Revenant        | 3f73-3ee4-8f6b-b16b | Missing     | Ward (6+) for Sylvaneth within 12"; -1 to enemy ward rolls within 12"                                        | M4d  |
| Realmroot Guide (trait)     | Warsong Revenant        | c133-8f0c-936d-30d3 | Missing     | Re-set up targets within the overgrowth, more than 9" from enemies                                           | M4g  |
| One With The Forest         | Dryads                  | f62f-75b0-48cd-101e | Missing     | -1 to hit and wound against the unit while wholly within the overgrowth                                      | M4d  |
| Aspect of Heartwood (trait) | Dryads                  | 0770-09a1-99c6-1a99 | Missing     | Changes Endless Growth: D6 or Heal 6, or return a model to Kurnothi (needs the player's choice)              | M4i  |

### Spell, prayer and manifestation lores

| Ability                    | Lore                      | BSData id           | Status      | Evidence                                       | Task |
| -------------------------- | ------------------------- | ------------------- | ----------- | ---------------------------------------------- | ---- |
| Jade Thorns                | Lore of the Deepwood      | 97df-e136-9fb4-5aca | Implemented | `magic.test.ts`; I27                           |      |
| Zephyrspite Rush           | Lore of the Deepwood      | 4ea1-b08a-3684-8d35 | Implemented | `magic.test.ts`; I27                           |      |
| Grasping Roots             | Lore of the Deepwood      | 77cf-59bd-fc8e-f6c7 | Implemented | `magic.test.ts`; I27                           |      |
| Song Of The Lost           | Lore of the Spirit-Song   | a865-102f-ce95-480c | Implemented | `magic.test.ts`, `modifiers.test.ts`; I27, I48 |      |
| Song Of Dread              | Lore of the Spirit-Song   | 4c37-4bd5-f9d5-170a | Implemented | `magic.test.ts`, `overgrowth.test.ts`; I49     |      |
| Song Of War                | Lore of the Spirit-Song   | 1b5b-a2e8-6dd3-17fb | Implemented | `magic.test.ts`; I27                           |      |
| Summon Aethervoid Pendulum | Aetherwrought Machineries | 678b-96e1-66bb-1de8 | Implemented | `magic.test.ts` (set-up, range, 9" gap); I24   |      |
| Summon Chronomantic Cogs   | Aetherwrought Machineries | c402-d205-c59f-e84b | Implemented | `magic.test.ts`, `summon-setup.test.ts`        |      |
| Summon Quicksilver Swords  | Aetherwrought Machineries | d4da-e543-192d-84ae | Implemented | `magic.test.ts`                                |      |

## Seraphon: Sunclaw Starhost

### Battle traits, formation and faction terrain

The four Asterism abilities (Itzl, Quetzl, Sotek, Tepok) can be used only once prophesied by The Great Plan (deployment) and Further the Great Plan (start of each round after the first); nothing of this exists.

| Ability                               | BSData id           | Status  | Gap                                                                    | Task |
| ------------------------------------- | ------------------- | ------- | ---------------------------------------------------------------------- | ---- |
| The Great Plan                        | 9db2-50c6-6181-fc51 | Missing | Choose the first prophesied Asterism at deployment                     | M4b  |
| Further the Great Plan                | 4d17-ddf6-7d2a-9889 | Missing | Start of rounds 2+: prophesy another, conditions per Asterism          | M4b  |
| Itzl the Tamer                        | 360d-fd80-f153-269f | Missing | Companion weapons of Seraphon get Crit (2 Hits)                        | M4b  |
| Quetzl the Preserver                  | 5089-fe1e-4dd7-5eb4 | Missing | -1 Rend on melee attacks against Seraphon wholly in friendly territory | M4b  |
| Sotek the Deliverer                   | 6960-effd-2a46-d7d4 | Missing | +2 Move for Seraphon                                                   | M4b  |
| Tepok the Seer                        | 90ae-3432-b3f3-4727 | Missing | +1 to casting rolls for Seraphon                                       | M4b  |
| Vengeance of Azyr (Sunclaw Starhost)  | 7c7e-3757-9881-5bd7 | Missing | Pile-in then D3 mortal damage on 2+                                    | M4c  |
| Fierce Guardians (Realmshaper Engine) | bf4d-2061-b8d1-193  | Missing | +1 to hit for Saurus and Kroxigor within 9" of the terrain             | M4m  |
| Power Unleashed (Realmshaper Engine)  | aa75-204a-4256-8c68 | Missing | Faction terrain never acts (I39)                                       | M4m  |

### Warscrolls

| Ability                       | Unit                         | BSData id           | Status      | Evidence and gaps                                                                                               | Task |
| ----------------------------- | ---------------------------- | ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| Arcane Vassal                 | Lord Kroak                   | 6bfc-5f30-ec02-307  | Missing     | Spell range and visibility measured from another unit                                                           | M4c  |
| Supreme Master of Order       | Lord Kroak                   | 244b-f6f2-322d-5345 | Missing     | +2 casting, +1 unbinding and banishment, unbind and banish anywhere. Unbind uses power level and 30" only (I58) | M4c  |
| Dead for Innumerable Ages     | Lord Kroak                   | c5a7-920c-9ff8-652  | Missing     | Forced each turn while damaged: 3D6 plus damage, 20+ destroys, otherwise Heal (18)                              | M4c  |
| Celestial Deliverance (spell) | Lord Kroak                   | f7bf-5a9-2828-a74   | Implemented | `magic.test.ts`; I29                                                                                            |      |
| Brutal Blows                  | Kroxigor                     | 786b-b219-e23-42f8  | Missing     | +1 Damage against units of 10 or more models                                                                    | M4f  |
| Starspawned                   | Sunblood Pack                | f571-744e-c103-8568 | Missing     | Ignore the first damage point each phase for Saurus and Kroxigor within 12"                                     | M4f  |
| Venomite Swarm                | Sunblood Pack                | cf2e-d237-9320-1105 | Missing     | Venomites token, D3 mortal damage                                                                               | M4h  |
| Scaled Protectors             | Sunblood Pack                | 3ffa-e9b3-901b-8d06 | Missing     | Ignore save modifiers; the engine has this for Song Of The Lost, not as a passive                               | M4f  |
| Beastmaster (trait)           | Sunblood Pack                | 5e50-d938-39d2-19a6 | Missing     | +2" Move to Cavalry and Monsters within 12" at the start of the move                                            | M4f  |
| Selfless Protectors           | Saurus Guard                 | e49d-3d7e-2eee-a5e0 | Missing     | Ward (5+) for the unit and Slann in combat range                                                                | M4f  |
| Celestial Conduit             | Saurus Astrolith Bearer      | 153d-3737-615b-b904 | Missing     | After a successful spell, +3 control score within 12"                                                           | M4h  |
| Revivifying Energies          | Saurus Astrolith Bearer      | 15e-ebba-9386-bd1a  | Missing     | Ward (6+), or (5+) if already 6+, for Seraphon Infantry within 12"                                              | M4f  |
| Ordered Cohorts               | Saurus Warriors              | 4181-bbd5-a4d8-1f59 | Missing     | +1 save while every model contests an objective you control                                                     | M4f  |
| Scry the Stars                | Skink Starseer               | b8a5-8e24-ad08-d213 | Missing     | Dice by round number, Ward (5+) on 3+                                                                           | M4h  |
| Celestial Doom (spell)        | Skink Starseer               | 2209-9b15-d3f-15ed  | Implemented | `magic.test.ts`; I29                                                                                            |      |
| Coatl Familiar (artefact)     | Skink Starseer               | 2302-6d4-c346-7bc6  | Missing     | Add D6 to a casting roll                                                                                        | M4h  |
| Ark of Sotek                  | Bastiladon with Ark of Sotek | 714c-4cb6-fce8-6ef9 | Missing     | D3 per target, mortal damage on 2+                                                                              | M4h  |
| Armour Cruncher (trait)       | Bastiladon with Ark of Sotek | f6fe-3e8d-dd90-00b8 | Missing     | Spend a rage dice, -1 to saves or raise the opponent's fury level                                               | M4h  |
| Hidden Hunters                | Hunters of Huanchi           | c78e-71e9-a948-fb09 | Missing     | Set up in reserve in ambush                                                                                     | M4j  |
| Star-venom                    | Hunters of Huanchi           | c71d-2217-fcf1-6110 | Missing     | 2+: -1 to wound for the target's combat attacks                                                                 | M4h  |
| Chameleon Ambush              | Hunters of Huanchi           | 4a89-1c50-df0e-4b2b | Missing     | Set up anywhere more than 9" from enemies                                                                       | M4j  |

### Spell and manifestation lores

| Ability                      | Lore                   | BSData id           | Status      | Evidence                                | Task |
| ---------------------------- | ---------------------- | ------------------- | ----------- | --------------------------------------- | ---- |
| Comet's Call                 | Celestial Manipulation | 78d-5a7e-a6c9-7674  | Implemented | `magic.test.ts`; I28                    |      |
| Mystical Unforging           | Celestial Manipulation | e0c2-6f59-3b19-9e51 | Implemented | `magic.test.ts`; I28                    |      |
| Speed of Huanchi             | Celestial Manipulation | 6086-ce9b-38be-28b2 | Implemented | `magic.test.ts`; I28                    |      |
| Summon Purple Sun of Shyish  | Morbid Conjuration     | 1b29-60f4-48d2-a6bb | Implemented | `magic.test.ts` (summons the warscroll) |      |
| Summon Malevolent Maelstrom  | Morbid Conjuration     | 1f2c-ca29-2c5b-24ba | Implemented | `magic.test.ts`                         |      |
| Summon Soulsnare Shackles    | Morbid Conjuration     | ee70-f212-c079-a752 | Implemented | `magic.test.ts` (18" range, no 9" gap)  |      |
| Summon Suffocating Gravetide | Morbid Conjuration     | 36e0-4b94-aeb-67ac  | Implemented | `magic.test.ts`                         |      |

## Summoned manifestations

Summoning is tested (above). The warscroll abilities of the manifestations are not implemented (S13: "warscroll passive/activated abilities on manifestations come in M4"). Their statlines and weapons are used; I24 covers movement, no objective control and no commands.

| Ability                       | Manifestation         | BSData id           | Status  | Gap                                                                                        | Task |
| ----------------------------- | --------------------- | ------------------- | ------- | ------------------------------------------------------------------------------------------ | ---- |
| Scything Blade                | Aethervoid Pendulum   | 54d0-e6a1-c6e8-46a7 | Missing | Move through units, D6 mortal damage on 2+ to up to 3 enemy units passed across            | M4k  |
| The Pendulum Swings           | Aethervoid Pendulum   | 9ec5-1011-c05e-5045 | Partly  | Cannot charge or fight (I24, `magic.test.ts`); the straight-line move is not enforced      | M4k  |
| Mechanisms of Time            | Chronomantic Cogs     | ad92-932-6f56-1d97  | Missing | Re-roll charges, or -1 to hit against Wizards, within 12"                                  | M4l  |
| Dancing Blades                | Quicksilver Swords    | 7b11-c623-fc14-4639 | Missing | No ward rolls against its damage                                                           | M4l  |
| End Given Form                | Purple Sun of Shyish  | 42b5-c322-7e12-371c | Missing | Move through units, D3 mortal damage on 2+ to up to 3 passed across                        | M4k  |
| Pull of the Nadir             | Purple Sun of Shyish  | c99-9240-9da1-d029  | Missing | -1 to save rolls for every unit within 3"                                                  | M4l  |
| Morbid Detonation             | Malevolent Maelstrom  | b8a4-541-b62-cf62   | Missing | Dice per target, mortal damage on 2+, then destroyed                                       | M4l  |
| Necrotic Vortex               | Malevolent Maelstrom  | c711-ce6-1fb6-7abc  | Missing | Maelstrom points from set-up, casts and slain models, up to 6                              | M4l  |
| Bound for the Great Oubliette | Soulsnare Shackles    | 6817-e507-443e-1ff4 | Missing | D3 mortal damage on 2+ and -Move                                                           | M4l  |
| Multiple Parts                | Soulsnare Shackles    | 9e13-160b-4a87-da4e | Partly  | One footprint instead of three parts (S13); destroyed on its Health in damage, which works | M4l  |
| Pulled to the Grave           | Suffocating Gravetide | 1fa3-5209-8869-8d58 | Missing | Move through units, 5+ per model in the target for mortal damage                           | M4k  |

## Battle tactic cards

Not BSData abilities, listed because the lists name them. Rules in `src/rules/core/tactics/`, tests in `src/rules/core/battleTactics.test.ts`.

| Card                  | Status      | Evidence and gaps                                               | Task |
| --------------------- | ----------- | --------------------------------------------------------------- | ---- |
| Flanking Firestorm    | Implemented | Strike and Domination tested                                    |      |
| Burning for Vengeance | Implemented | Strike and Domination tested; fugitive pick (I41)               |      |
| Siege of Ashes        | Partly      | Code for all three tiers; only Affray (Form a Wall) is tested   | M4n  |
| Legend of the Parch   | Partly      | Code for all three tiers; only Affray (Daring Rescue) is tested | M4n  |

## Not counted

- Weapon abilities (Crit, Companion, Anti-X and so on) are core rules, in `src/data/profile.ts` and `src/rules/core/modifiers.ts`. The weapon choice per model is S8.
- Core commands (Rally, At the Double and the rest) and Fight Through the Pain, Eruption of Fury, Place of Power: core rules, tested (`commands.test.ts`, `magic.test.ts`, `fury-pain.test.ts`, `eruption.test.ts`).
- Enhancements and abilities of units only on the Seraphon placeholder list (Skink Starpriest, Spawn of Chotec, Aggradon Lancers, Saurus Scar-Veteran, Realmshaper Engine apart from its terrain abilities).
- Visibility for spells and abilities needs an owner ruling (RULES-DECISIONS, "Awaiting the owner's ruling"); it affects every targeted spell above.
