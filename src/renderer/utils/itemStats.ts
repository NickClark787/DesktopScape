/**
 * Pure item-stat formatting shared by the gear tooltips (GearIcon/GearGrid)
 * and the picker's one-line row summaries. Kept free of React/DOM so the
 * formatting — especially the magic-damage unit conversion — is unit-testable.
 */
import type { EquipmentPiece } from '@shared/types';

export function pieceLabel(p: EquipmentPiece): string {
  return p.version ? `${p.name} (${p.version})` : p.name;
}

/** Format a +N or -N number with an explicit sign for tooltip readability. */
function s(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * `bonuses.magic_str` is stored in TENTHS of a percent (Occult necklace = 50
 * = +5% magic damage). Convert for display — showing the raw value with a %
 * suffix overstated every magic-damage bonus tenfold.
 */
export function magicStrPct(tenths: number): string {
  const pct = tenths / 10;
  const digits = Number.isInteger(pct) ? 0 : 1;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

/**
 * Stat lines (without the name) for an item tooltip. Skips zero-valued lines
 * so a typical chip isn't a wall of "+0"s.
 */
export function pieceStatLines(p: EquipmentPiece): string[] {
  const lines: string[] = [];
  const slotLabel = p.slot === '2h' ? 'weapon (2h)' : p.slot;
  lines.push(slotLabel);

  const off = p.offensive;
  const offParts = [
    off.stab && `stab ${s(off.stab)}`,
    off.slash && `slash ${s(off.slash)}`,
    off.crush && `crush ${s(off.crush)}`,
    off.magic && `magic ${s(off.magic)}`,
    off.ranged && `ranged ${s(off.ranged)}`,
  ].filter(Boolean);
  if (offParts.length) lines.push(`Attack: ${offParts.join(', ')}`);

  const b = p.bonuses;
  const bonusParts = [
    b.str && `str ${s(b.str)}`,
    b.ranged_str && `ranged str ${s(b.ranged_str)}`,
    b.magic_str && `magic dmg ${magicStrPct(b.magic_str)}`,
    b.prayer && `prayer ${s(b.prayer)}`,
  ].filter(Boolean);
  if (bonusParts.length) lines.push(`Bonus: ${bonusParts.join(', ')}`);

  const def = p.defensive;
  const defParts = [
    def.stab && `stab ${s(def.stab)}`,
    def.slash && `slash ${s(def.slash)}`,
    def.crush && `crush ${s(def.crush)}`,
    def.magic && `magic ${s(def.magic)}`,
    def.ranged && `ranged ${s(def.ranged)}`,
  ].filter(Boolean);
  if (defParts.length) lines.push(`Defence: ${defParts.join(', ')}`);

  // Speed is only meaningful for weapons.
  if (p.slot === 'weapon' && p.speed) {
    lines.push(`Speed: ${p.speed} tick${p.speed === 1 ? '' : 's'}`);
  }

  return lines;
}

/** Full multi-line summary for a native `title` tooltip. */
export function pieceTooltip(p: EquipmentPiece): string {
  return [pieceLabel(p), ...pieceStatLines(p)].join('\n');
}

/**
 * One-line stat summary for a picker list row. Picks the offensive style with
 * the largest bonus + the matching strength bonuses, so a player can scan
 * rows for "what's actually different about this piece".
 */
export function summarizeStats(p: EquipmentPiece): string {
  const off = p.offensive;
  const styles: Array<[string, number]> = [
    ['stab', off.stab], ['slash', off.slash], ['crush', off.crush],
    ['magic', off.magic], ['ranged', off.ranged],
  ];
  const top = styles.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
  const parts: string[] = [];
  if (top[1]) parts.push(`${top[0]} ${top[1] > 0 ? '+' : ''}${top[1]}`);
  const b = p.bonuses;
  if (b.str) parts.push(`str ${b.str > 0 ? '+' : ''}${b.str}`);
  if (b.ranged_str) parts.push(`rng str ${b.ranged_str > 0 ? '+' : ''}${b.ranged_str}`);
  if (b.magic_str) parts.push(`mag dmg ${magicStrPct(b.magic_str)}`);
  if (b.prayer) parts.push(`pray ${b.prayer > 0 ? '+' : ''}${b.prayer}`);
  if (p.slot === 'weapon' && p.speed) parts.push(`spd ${p.speed}t`);
  return parts.join(' · ') || p.category || '—';
}
