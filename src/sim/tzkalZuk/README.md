# TzKal-Zuk simulator (`sim/tzkalZuk`)

Tick-accurate, deterministic simulation of the Inferno wave-69 TzKal-Zuk
fight. Built to the **same design as the Sol Heredit sim** (`sim/solHeredit`)
— a self-contained, headless, framework-free engine that the UI
(`src/renderer/components/inferno/`) only feeds inputs and reads snapshots
from. It runs under vitest and could drive thousands of headless
Monte-Carlo runs unchanged.

Mechanics were verified against the OSRS Wiki (`TzKal-Zuk`,
`Inferno/Strategies`) on 2026-07-12. Values the wiki does **not** publish —
the Ancestral Glyph's tile width and patrol cadence, and the add-set spawn
geometry — are modelled from community strategy and flagged in
`constants.ts`; they are trivially overridable via `BossOptions`/modifiers
for drills.

## The tick model

- One `TzKalZukSim.advance()` = **one game tick = 0.6 s**. All timing is in
  ticks; wall-clock pacing (0.25×–4×, tick-step) is the UI's job.
- Fixed per-tick pipeline: **inputs → player upkeep → movement → glyph
  patrol → HP-gated spawns (Jad @480, enrage+healers @240) → add-set timer
  → Zuk shot → adds → healers → player attack → end conditions**.
  Determinism depends on this order never varying.
- Two seeded RNG streams (`mulberry32`): `simRng` (consumed only inside
  `advance()`) and `netRng` (once per `queueInput()` for latency jitter/loss).
  A `(seed, input stream)` pair reproduces a run bit-for-bit — the basis of
  replays and scrub-by-resimulation (`replay.ts`).
- Player offense comes from the shared `calcDps` (`src/engine/formulas.ts`),
  computed per target (Zuk / ranger / mager / Jad) and per gear set, so gear
  math matches the optimizer. Prayer drain uses the shared
  `src/engine/prayerDrain.ts`.

### The fight, mechanically

| Mechanic | Model |
|---|---|
| **Ancestral Glyph** | A `GLYPH_WIDTH`-wide bar one row south of Zuk, sliding east↔west (`glyph.ts`). Zuk's shot is blocked only when the player stands in a covered column *south* of the bar — the shuffle. Each blocked shot chips the 600-HP shield; enough chips destroy it and expose the player. |
| **Zuk** | Attacks every 10 ticks (7 enraged), typeless up to 148, **unpreventable by prayer** — the glyph is the only defence. |
| **Add sets** | One Jal-Xil (ranged) + one Jal-Zek (magic) per set. First set gates on a full glyph rotation; later sets on a 350-tick timer that **pauses across the 600→480 HP band** (wiki). Blocked by the matching overhead prayer; Jal-Zek revives once. |
| **JalTok-Jad** | Spawns at 480 HP; each attack randomly telegraphs magic or ranged, and the matching overhead must be active on the landing tick or it hits for up to 113. |
| **Enrage + healers** | At 240 HP Zuk speeds up and four Jal-MejJak healers spawn, healing Zuk 15–25 every 3 ticks — a kill race. |

### Input latency

`queueInput({ cmd, clientTick, msIntoTick })` → the command takes effect at
the start of the first tick after `clientTick·600 + msIntoTick + ping(±jitter)`
crosses a boundary. At 0 ms this is the OSRS ideal (T→T+1); real ping is
what makes an overhead switch on Jad or a mager arrive a tick late.

## File map

| File | What lives there |
|---|---|
| `constants.ts` | every number, with wiki citations + flagged approximations |
| `types.ts` | config / input / event / snapshot shapes |
| `rng.ts` | seedable mulberry32 (same generic stream as Sol) |
| `glyph.ts` | Ancestral Glyph patrol + protection geometry |
| `player.ts` | stats, overhead + offensive prayers, consumables, movement |
| `engine.ts` | the tick pipeline + entity management |
| `replay.ts` | export / import / scrub |
| `results.ts` | event-log → results summary |

## Adding a preset

Presets are declarative JSON. Drop a file in
`src/renderer/inferno/presets/` and list it in
`src/renderer/inferno/presets.ts` (`PRESET_FILES`):

```jsonc
{
  "name": "My preset",
  "description": "Shown as a tooltip",
  "gear": { "weapon": "Twisted bow", "head": "Masori mask (f)" },
  "gearVersions": { "weapon": "" },          // optional version pins
  "inventory": [ { "item": "saradomin_brew", "qty": 8 } ],
  "skills": { "atk": 99, "str": 99, "def": 99, "hp": 99,
              "magic": 99, "ranged": 99, "prayer": 99 },
  "settings": { "latency": { "pingMs": 0, "jitterMs": 0, "packetLossPct": 0 } }
}
```

Gear entries are item **names** resolved against the live equipment
database at load time (unknown names warn and are skipped). Inventory
`item` ids come from `CONSUMABLES` in `constants.ts`. Presets are read-only
in the UI — saving forks them into a versioned-localStorage profile
(`renderer/inferno/profiles.ts`, key `gearscape:inferno:profiles`).

## Known simplifications (documented in code)

- The glyph's exact tile width and cadence, and the shield's per-hit chip,
  are modelled (the wiki gives none); tune them in `constants.ts`.
- Adds don't path — they attack on cadence from their spawn tile; the
  player is always in ranged range of everything.
- Jal-Zek revives exactly once; the healers' pull-and-trap positioning is
  abstracted to "kill them before they out-heal your DPS".
- Special attacks and gear switches beyond the main set aren't modelled
  (the fight is a single ranged setup).
