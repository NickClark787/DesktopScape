import type { Monster } from '@shared/types';
import { isFailedImage, markFailedImage } from './imageCache';

/**
 * Single-monster icon backed by the OSRS Wiki CDN. Mirrors `GearIcon`'s
 * shape so the two read consistently throughout the UI: shared error
 * fallback, native multi-line title tooltip, the same denylist behavior,
 * and the same `lg` "fill the parent" mode for grid cells.
 *
 * Sizes are tuned for the surfaces they're used on:
 *   xs (20px) — chip-density labels (selected-monster pill)
 *   sm (28px) — picker list rows
 *   md (40px) — emphasized headers (results panel target line)
 *   lg (full) — detail callouts (caller controls the box)
 */
type Size = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_PX: Record<Exclude<Size, 'lg'>, number> = {
  xs: 20,
  sm: 28,
  md: 40,
};

interface Props {
  monster: Monster | null | undefined;
  size?: Size;
  /** Override the hover title. Defaults to a multi-line stats summary. */
  title?: string;
  /** Extra classes for the wrapping element (positioning, ring, etc). */
  className?: string;
}

function monsterLabel(m: Monster): string {
  return m.version ? `${m.name} (${m.version})` : m.name;
}

function s(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Build a multi-line stats summary suitable for a native `title` tooltip.
 * Mirrors `GearIcon`'s tooltip style — skip zero/empty fields so a typical
 * monster entry stays compact.
 */
function monsterTooltip(m: Monster): string {
  const lines: string[] = [monsterLabel(m)];
  lines.push(`Lv ${m.level} · ${m.skills.hp} HP`);

  // Combat: which styles the monster attacks with, plus its max hit.
  const styles = m.style && m.style.length ? m.style.join(', ') : null;
  if (styles) lines.push(`Attacks: ${styles}${m.max_hit ? ` (max ${m.max_hit})` : ''}`);

  // Defensive: just the relevant non-zero defence levels — no use cluttering
  // the tooltip with the half-dozen "+0"s a typical low-level monster has.
  const def = m.defensive;
  const defParts = [
    def.stab && `stab ${s(def.stab)}`,
    def.slash && `slash ${s(def.slash)}`,
    def.crush && `crush ${s(def.crush)}`,
    def.magic && `magic ${s(def.magic)}`,
    def.standard && `ranged ${s(def.standard)}`,
  ].filter(Boolean);
  if (defParts.length) lines.push(`Defence ${m.skills.def}: ${defParts.join(', ')}`);

  if (m.weakness?.element) {
    const sev = m.weakness.severity ? ` (${m.weakness.severity}%)` : '';
    lines.push(`Weakness: ${m.weakness.element}${sev}`);
  }

  return lines.join('\n');
}

export function MonsterIcon({ monster, size = 'sm', title, className }: Props) {
  if (!monster) return null;
  const label = title ?? monsterTooltip(monster);
  const src = window.gearscape.cdnImage(monster.image, 'monsters');

  // Same denylist trick as GearIcon — render an invisible placeholder of the
  // expected size so layout doesn't shift when the CDN is missing the sprite.
  if (isFailedImage(src)) {
    if (size === 'lg') {
      return <div className={['w-full h-full', className ?? ''].join(' ')} title={label} />;
    }
    const px = SIZE_PX[size];
    return (
      <div
        title={label}
        className={['shrink-0', className ?? ''].join(' ')}
        style={{ width: px, height: px }}
      />
    );
  }

  if (size === 'lg') {
    return (
      <img
        src={src}
        alt={monster.name}
        title={label}
        className={['w-full h-full object-contain p-1', className ?? ''].join(' ')}
        style={{ imageRendering: 'pixelated' }}
        onError={(e) => {
          markFailedImage(src);
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
    );
  }

  const px = SIZE_PX[size];
  return (
    <img
      src={src}
      alt={monster.name}
      title={label}
      width={px}
      height={px}
      className={['object-contain shrink-0', className ?? ''].join(' ')}
      style={{ imageRendering: 'pixelated', width: px, height: px }}
      onError={(e) => {
        markFailedImage(src);
        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}
