# GearScape Desktop

Desktop best-in-slot / DPS calculator for Old School RuneScape, inspired by
[gearscape.net](https://gearscape.net) and [tools.runescape.wiki/osrs-dps](https://tools.runescape.wiki/osrs-dps/).

Picks the highest-DPS gear setup for any in-game encounter, given your stats,
prayers, potions, and available items.

## Run it

```
npm install
npm run dev
```

Builds a Windows installer:

```
npm run dist:win
```

Output: `release/GearScape Desktop-<version>-x64.exe`

## Data

On first launch the app ships with a bundled snapshot of equipment / monster /
spell data (see `resources/data/`). The **Refresh data** button in Settings
pulls the latest from Weird Gloop's public CDN
(`https://tools.runescape.wiki/osrs-dps/cdn/json/`).

## License

GPL-3.0-or-later. See `LICENSE` and `NOTICE.md` for third-party attribution.
