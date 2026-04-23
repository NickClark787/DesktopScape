import type { EquipmentPiece, EquipmentSlot, PlayerLoadout } from '@shared/types';
import { GearIcon } from './GearIcon';

type Slot = Exclude<EquipmentSlot, '2h'>;

interface Props {
  equipment: PlayerLoadout['equipment'];
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

function Cell({ slot, piece }: { slot: Slot | null; piece: EquipmentPiece | null | undefined }) {
  if (slot === null) return <div />;
  return (
    <div className="slot-cell group" title={piece ? piece.name : SLOT_LABEL[slot]}>
      {piece ? (
        <GearIcon piece={piece} size="lg" />
      ) : (
        <span className="text-text-faint text-[11px] uppercase tracking-wide">{SLOT_LABEL[slot]}</span>
      )}
    </div>
  );
}

export function GearGrid({ equipment }: Props) {
  return (
    <div className="grid grid-cols-3 gap-1.5 w-[240px]">
      {LAYOUT.map((slot, i) => (
        <Cell key={i} slot={slot} piece={slot ? equipment[slot] ?? null : null} />
      ))}
    </div>
  );
}
