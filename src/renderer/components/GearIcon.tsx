import type { EquipmentPiece } from '@shared/types';

/**
 * Single-piece equipment icon backed by the OSRS Wiki CDN.
 *
 * The CDN occasionally 404s for items missing from the wiki image set
 * (broken/used set variants, niche cosmetics). The onError handler hides
 * the broken image rather than showing a torn-icon — the surrounding
 * background still reads as a slot, and the title attribute keeps the
 * piece name discoverable on hover.
 *
 * Sizes are tuned for the surfaces they're used on:
 *   xs (16px) — chip-density lists (saved loadout previews)
 *   sm (24px) — inline list rows (search results, owned items)
 *   md (32px) — emphasized list rows (pieces list in ResultsPanel)
 *   lg (full) — equipment-grid cells (GearGrid)
 */
type Size = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_PX: Record<Exclude<Size, 'lg'>, number> = {
  xs: 16,
  sm: 24,
  md: 32,
};

interface Props {
  piece: EquipmentPiece | null | undefined;
  /** Size preset. `lg` fills its container (use inside an aspect-square slot cell). */
  size?: Size;
  /** Override the hover title. Defaults to `piece.name` (with version suffix). */
  title?: string;
  /** Extra classes for the wrapping element (positioning, ring, etc). */
  className?: string;
}

function pieceLabel(p: EquipmentPiece): string {
  return p.version ? `${p.name} (${p.version})` : p.name;
}

export function GearIcon({ piece, size = 'sm', title, className }: Props) {
  if (!piece) return null;
  const label = title ?? pieceLabel(piece);
  const src = window.gearscape.cdnImage(piece.image);

  if (size === 'lg') {
    // Caller controls the box; we just fill it.
    return (
      <img
        src={src}
        alt={piece.name}
        title={label}
        className={['w-full h-full object-contain p-1', className ?? ''].join(' ')}
        style={{ imageRendering: 'pixelated' }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
      />
    );
  }

  const px = SIZE_PX[size];
  return (
    <img
      src={src}
      alt={piece.name}
      title={label}
      width={px}
      height={px}
      className={['object-contain shrink-0', className ?? ''].join(' ')}
      style={{ imageRendering: 'pixelated', width: px, height: px }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
    />
  );
}
