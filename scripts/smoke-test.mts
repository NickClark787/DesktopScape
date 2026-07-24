import { readFile } from 'node:fs/promises';
import { findBestSetup, findBestMeleeSetup, findBestMagicSetup } from '../src/engine/bestSetup.ts';
import { patchEquipmentData } from '../src/shared/dataPatches.ts';
import type { Monster, EquipmentPiece, PlayerLoadout, CombatStyle } from '../src/shared/types.ts';

const equipment: EquipmentPiece[] = JSON.parse(await readFile('resources/data/equipment.json', 'utf8'));
// Mirror the app: main/index.ts patches known-bad upstream entries before the
// renderer ever sees them. Without this the smoke test optimizes over raw
// data and picks patched-out items (e.g. Barbed arrow's phantom +125).
patchEquipmentData(equipment);
const monsters: Monster[] = JSON.parse(await readFile('resources/data/monsters.json', 'utf8'));

const target: Monster = monsters.find((m) => m.name === 'Vorkath' && (m.version || '').includes('Post'))
  ?? monsters.find((m) => m.name === 'Vorkath')!;

const basePlayer: PlayerLoadout = {
  style: 'melee',
  attackStyle: 'slash',
  skills: { atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 },
  prayers: {
    piety: true, chivalry: false, ultimateStrength: false, superhumanStrength: false,
    burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
    rigour: true, eagleEye: false, hawkEye: false, sharpEye: false,
    augury: true, mysticMight: false, mysticLore: false, mysticWill: false,
  },
  potions: { melee: 'super_combat', ranged: 'divine_ranging', magic: 'saturated_heart' },
  onSlayerTask: false,
  inWilderness: false,
  equipment: {},
  spell: null,
};

const styles: CombatStyle[] = ['melee', 'ranged', 'magic'];
for (const style of styles) {
  const t = Date.now();
  const out = style === 'melee'
    ? findBestMeleeSetup({ ...basePlayer, style }, target, equipment, { shortlistPerSlot: 6 })
    : style === 'magic'
    ? findBestMagicSetup({ ...basePlayer, style }, target, equipment, { shortlistPerSlot: 6 })
    : findBestSetup({ ...basePlayer, style, attackStyle: style }, target, equipment, {
        style, attackStyle: style, shortlistPerSlot: 6,
      });
  const ms = Date.now() - t;
  if (!out) { console.log(`${style}: no result`); continue; }
  console.log(`\n== ${style} vs ${target.name} (${ms} ms) ==`);
  console.log(`  DPS:      ${out.result.dps.toFixed(3)}`);
  console.log(`  Max hit:  ${out.result.maxHit}`);
  console.log(`  Accuracy: ${(out.result.accuracy * 100).toFixed(1)}%`);
  console.log(`  TTK:      ${out.result.ttkSeconds.toFixed(1)}s`);
  if (style === 'magic') console.log(`  Spell:    ${out.spell ?? '(powered staff)'}`);
  for (const [slot, piece] of Object.entries(out.equipment)) {
    if (!piece) continue;
    console.log(`    ${slot.padEnd(8)} ${piece.name}${piece.version ? ` (${piece.version})` : ''}`);
  }
}
