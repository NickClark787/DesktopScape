import type { EquipmentPiece, EquipmentSlot, PlayerLoadout } from '@shared/types';
import { GearIcon, pieceLabel, pieceStatLines } from './GearIcon';

type Slot = Exclude<EquipmentSlot, '2h'>;

interface Props {
  equipment: PlayerLoadout['equipment'];
  /** When provided, slot cells become clickable and call this with the slot. */
  onSlotClick?: (slot: Slot) => void;
}

// OSRS equipment interface layout — 3-column grid mirroring the in-game panel.
const LAYOUT: Array<Slot | null> = [
  null,    'head',   null,
  'cape',  'neck',   'ammo',
  'weapon','body',   'shield',
  null,    'legs',   null,
  'hands', 'feet',   'ring',
];

const SLOT_LABEL: Record<Slot, string> = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo', weapon: 'Weapon',
  body: 'Body', shield: 'Shield', legs: 'Legs', hands: 'Hands', feet: 'Feet', ring: 'Ring',
};

/**
 * OSRS-style item tooltip card: yellow item name, stat lines beneath, on a
 * dark gold-framed card. Pure presentation — shown/hidden by the parent
 * `group` via opacity+visibility (no layout or shadow animation).
 */
function SlotTooltip({ piece }: { piece: EquipmentPiece }) {
  return (
    <span
      role="tooltip"
      className="osrs-tooltip bottom-full left-1/2 -translate-x-1/2 mb-2
                 opacity-0 invisible transition-[opacity,visibility] duration-100
                 group-hover:opacity-100 group-hover:visible
                 group-focus-visible:opacity-100 group-focus-visible:visible"
    >
      <span className="osrs-tooltip-name">{pieceLabel(piece)}</span>
      {pieceStatLines(piece).map((line, i) => (
        <span key={i} className="osrs-tooltip-line">{line}</span>
      ))}
    </span>
  );
}

function Cell({
  slot,
  piece,
  onClick,
}: {
  slot: Slot | null;
  piece: EquipmentPiece | null | undefined;
  onClick?: () => void;
}) {
  if (slot === null) return <div />;
  // When clickable we render a button so keyboard users get focus + Enter.
  const interactive = !!onClick;
  const emptyTitle = `${SLOT_LABEL[slot]}${interactive ? ' (click to pick)' : ''}`;
  // Keying the icon by piece id re-mounts it on a swap, replaying the pop-in
  // animation — a piece visibly "drops" into its well when equipped. The
  // styled tooltip replaces the native title for filled slots (GearIcon's
  // own title is suppressed with an empty override).
  const content = piece ? (
    <>
      <span key={piece.id} className="animate-pop-in inline-flex">
        <GearIcon piece={piece} size="lg" title="" />
      </span>
      <SlotTooltip piece={piece} />
    </>
  ) : (
    <span className="font-pixel text-text-faint text-[11px] uppercase tracking-wide">{SLOT_LABEL[slot]}</span>
  );
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={piece ? pieceLabel(piece) : emptyTitle}
        title={piece ? undefined : emptyTitle}
        className="slot-cell group"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="slot-cell group" title={piece ? undefined : emptyTitle}>
      {content}
    </div>
  );
}

export function GearGrid({ equipment, onSlotClick }: Props) {
  return (
    <div className="grid grid-cols-3 gap-1.5 w-[240px]">
      {LAYOUT.map((slot, i) => (
        <Cell
          key={i}
          slot={slot}
          piece={slot ? equipment[slot] ?? null : null}
          onClick={slot && onSlotClick ? () => onSlotClick(slot) : undefined}
        />
      ))}
    </div>
  );
}
