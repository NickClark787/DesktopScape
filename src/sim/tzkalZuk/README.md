# TzKal-Zuk simulator (`sim/tzkalZuk`)

Tick-accurate, deterministic simulation of the Inferno wave-69 TzKal-Zuk
fight. Built to the **same design as the Sol Heredit sim** (`sim/solHeredit`)
— a self-contained, headless, framework-free engine that the UI
(`src/renderer/components/inferno/`) only feeds inputs and reads snapshots
from. It runs under vitest and could drive thousands of headless
Monte-Carlo runs unchanged.

The visual layer lives in
[`src/renderer/inferno/render`](../../renderer/inferno/render/README.md),
built on the shared
[arena render core](../../renderer/arena/README.md) — canvas
architecture, the tick-to-frame interpolation model, quality tiers and how
to add an effect are documented there. It reads `SimSnapshot` and never
recomputes fight state; anything it needs is added here as a read-only
snapshot field.

Mechanics were re-verified against the OSRS Wiki (`TzKal-Zuk`, `Inferno`,
`Inferno/Strategies`, `Ancestral glyph`, and each Jal- monster's own page)
on 2026-08-07; every number in `constants.ts` carries the page it came
from. Values the wiki does **not** publish — the Ancestral Glyph's tile
width and patrol cadence, the add-set spawn geometry, and the
animation→landing windup lengths — are modelled from community strategy and
marked MODELLED in `constants.ts`; they are trivially overridable via
`BossOptions`/modifiers for drills.

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
| **Ancestral Glyph** | A `GLYPH_WIDTH`-wide bar one row south of Zuk, sliding east↔west (`glyph.ts`). Zuk's shot is blocked whenever the player stands in a covered column *south* of the bar — the shuffle. Zuk's own shots **never damage it** ("it can sustain TzKal-Zuk's attacks indefinitely"); its 600 HP is spent only against the spawned monsters. The patrol is 80 ticks = exactly 8 Zuk attacks, which is what gives the fight its four consistent safespots. |
| **Zuk** | Attacks every 10 ticks (7 enraged). A single roll 0–148 — the average of his 128 magic and 169 ranged maxes (Mod Ash) — **unpreventable by prayer and not tick-eatable**; the glyph is the only defence. He still rolls accuracy: averaged ranged/magic attack roll vs the average of the player's ranged and magic defence rolls. |
| **Spawn aggression** | Everything that spawns opens on the **shield**, not on you, and switches to you the moment you attack it. Ignore them and the shield collapses — that is the real shield-loss channel, and the reason the fight is a tagging exercise. |
| **Add sets** | One Jal-Xil (ranged) + one Jal-Zek (magic) per set. First set gates on a full glyph rotation; later sets on a 350-tick timer that **pauses across the 600→480 HP band and gains a one-time +175 ticks** at 600 HP. Blocked by the matching overhead prayer once tagged. |
| **Jal-Zek revive** | 1/10 chance per attack to revive *another* fallen monster (never itself) at half HP near the arena centre; each monster only once, and the Jal-Zek does nothing for 7 ticks afterwards. |
| **JalTok-Jad** | Spawns at 480 HP on the shield; each attack randomly telegraphs magic or ranged, and the matching overhead must be active on the landing tick or it hits for up to 113. At half health it spawns three Yt-HurKot that heal it until tagged. |
| **Enrage + healers** | At 240 HP Zuk speeds up and four Jal-MejJak spawn, healing Zuk 15–24 every 3 ticks **until you tag them**; a tagged one stops healing and rains 5–10 lava balls instead. |

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
| `npcCombat.ts` | monster → player attack/defence rolls (ported from the wiki calc) |
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

- The glyph's exact tile width and cadence are modelled (the wiki gives
  none); the cadence is pinned by the published "attack cycle and shield
  rotation align" constraint. Tune them in `constants.ts`.
- Adds don't path — they attack on cadence from their spawn tile; the
  player is always in range of everything, and monster attack *ranges* are
  therefore not modelled.
- The Jal-MejJak lava-ball AoE is a flat 5–10 chip on every tagged healer's
  cycle rather than a positional 3×3 splash you can step out of.
- Yt-HurKot heal rate is modelled (the wiki publishes none). Jad's melee is
  not modelled — the sim never places the player adjacent to it.
- Special attacks and gear switches beyond the main set aren't modelled
  (the fight is a single ranged setup).

## Deliberately *not* modelled, because the wiki says they don't happen

- **Jal-Nib in wave 69.** Nibblers "always spawn in every wave until wave
  67"; there are none at Zuk.
- **The shield halting during a healer or Jad phase.** No source says the
  patrol stops; the strategies page in fact tells you to keep moving with
  it through the enrage.
- **A healer phase at 480 HP.** 480 is the JalTok-Jad trigger; the
  Jal-MejJak healers are the 240 HP trigger only.
