import type { EquipmentPiece, EquipmentSlot, PlayerLoadout } from '@shared/types';
import { GearIcon } from './GearIcon';

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
  // When clickable we render a button so keyboard users get focus + Enter,
  // and we add a subtle hover ring to advertise the affordance.
  const interactive = !!onClick;
  const baseTitle = piece ? piece.name : `${SLOT_LABEL[slot]} (click to pick)`;
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={baseTitle}
        className="slot-cell group hover:border-accent focus:border-accent focus:outline-none transition-colors cursor-pointer"
      >
        {piece ? (
          <GearIcon piece={piece} size="lg" />
        ) : (
          <span className="text-text-faint text-[11px] uppercase tracking-wide">{SLOT_LABEL[slot]}</span>
        )}
      </button>
    );
  }
  return (
    <div className="slot-cell group" title={baseTitle}>
      {piece ? (
        <GearIcon piece={piece} size="lg" />
      ) : (
        <span className="text-text-faint text-[11px] uppercase tracking-wide">{SLOT_LABEL[slot]}</span>
      )}
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
