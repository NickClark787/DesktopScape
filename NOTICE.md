# Third-party attribution

GearScape Desktop is released under the GNU General Public License v3.0 (or later). See `LICENSE`.

## Combat formulas and reference implementation

The core damage/accuracy/DPS formulas implemented in `src/engine/` are based on the
publicly documented combat research by **Bitterkoekje** (OSRS forums), and the
open-source OSRS DPS calculator maintained by **Weird Gloop**:

- https://github.com/weirdgloop/osrs-dps-calc (GPL-3.0)
- https://tools.runescape.wiki/osrs-dps/

Because this project links to / derives from a GPL-3.0 codebase, GearScape Desktop
is itself distributed under the GPL-3.0 license.

## Game data

Equipment, monster, and spell JSON snapshots bundled under `resources/data/` were
originally produced by scraping the [OSRS Wiki](https://oldschool.runescape.wiki/)
via Weird Gloop's CDN at `https://tools.runescape.wiki/osrs-dps/cdn/`.

The app can refresh this data at runtime from the same CDN. Game content, item
names, and monster data are © Jagex Ltd.

## Icons / images

Equipment and monster icons are loaded on demand from
`https://tools.runescape.wiki/osrs-dps/cdn/` and are sourced from the OSRS Wiki
(CC BY-NC-SA 3.0).

## Fonts

Two typefaces are bundled and redistributed under `src/renderer/assets/fonts/`,
each under the SIL Open Font License 1.1. The full license text ships alongside
each font file:

- **Cinzel** by Natanael Gama — `Cinzel-OFL.txt`
- **Pixelify Sans** by Stefie Justprince — `PixelifySans-OFL.txt`

No Jagex/OSRS typeface is bundled, traced, or reproduced.
