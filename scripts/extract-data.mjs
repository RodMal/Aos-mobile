// Copies the game data this app needs from a BSData-parser checkout into data/.
//
// Usage: pnpm data:extract <path to BSData-parser/packages/aos-data/data/v1>
//
// The source is the generated, zod-validated JSON that BSData-parser builds from
// BSData/age-of-sigmar-4th. This script only selects and prunes; it never changes a value.
// Output is deterministic, so re-running against the same source gives identical files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FACTIONS = ['sylvaneth', 'seraphon', 'universal'];
const RULESET = 'ghb-2026-27';

const src = process.argv[2];
if (!src) {
  console.error('usage: pnpm data:extract <path to aos-data/data/v1>');
  process.exit(1);
}
const srcDir = resolve(src);
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const read = (rel) => JSON.parse(readFileSync(join(srcDir, rel), 'utf8'));
const write = (rel, value) => {
  const file = join(outDir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value) + '\n');
  console.log(`wrote data/${rel}`);
};

const loreRefs = new Set();
let dataVersion;
for (const slug of FACTIONS) {
  const faction = read(`factions/${slug}.json`);
  dataVersion ??= faction.dataVersion;
  if (faction.dataVersion !== dataVersion) throw new Error(`mixed data versions in ${slug}`);
  // Regiments of Renown are out of scope for now and are large.
  faction.regimentsOfRenown = [];
  for (const lore of faction.lores ?? []) if (lore.loreRef) loreRefs.add(lore.loreRef);
  write(`factions/${slug}.json`, faction);
}

const lores = read('lores.json');
lores.lores = lores.lores.filter((lore) => loreRefs.has(lore.id));
write('lores.json', lores);

const ruleset = read(`rulesets/${RULESET}.json`);
delete ruleset.regimentsOfRenown;
write('ruleset.json', ruleset);

console.log(`data version (BSData SHA): ${dataVersion}; ${lores.lores.length} lores kept`);
