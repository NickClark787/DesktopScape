# Sol Heredit simulator (`sim/solHeredit`)

Tick-accurate, deterministic simulation of the Fortis Colosseum wave-12
fight. **Headless by design**: nothing in this directory touches the DOM,
React, or timers — the UI (`src/renderer/components/colosseum/`) is a thin
layer that feeds inputs in and draws snapshots out. That means the engine
can run under vitest, or thousands of times in a loop for Monte-Carlo
analysis, unchanged.

Mechanics were verified against the OSRS Wiki (`Sol_Heredit`,
`Fortis_Colosseum/Strategies`) on 2026-07-12; the deviations between the
wiki and the original feature request (AoE max 44 not ~45, beam spheres up
to 75, triple-parry damage tiers) follow the wiki and are noted in
`constants.ts`.

## The tick model

- One call to `SolHereditSim.advance()` = **one game tick = 0.6 s**. There
  are no milliseconds anywhere inside the engine; wall-clock pacing
  (0.25x–4x, tick-step) is entirely the UI's job.
- Each tick runs a fixed pipeline: **inputs → player upkeep (cooldowns,
  prayer drain, boost decay) → movement → transition beams/sand → enrage
  sand → boss script → player auto-attack → end conditions**. Determinism
  depends on this order never varying.
- Two independent RNG streams (`mulberry32`), both derived from the seed:
  - `simRng` — consumed only inside `advance()`, in pipeline order.
  - `netRng` — consumed once per `queueInput()` for latency jitter and
    packet loss, in input order.
  A `(seed, input stream)` pair therefore reproduces a run bit-for-bit.

### Input latency

`queueInput({ cmd, clientTick, msIntoTick })` models the click happening
`msIntoTick` ms into `clientTick`. One-way ping (± jitter) is added, and
the command takes effect at the **start of the first tick after arrival**:

```
effectTick = floor((clientTick·600 + msIntoTick + delay) / 600) + 1
```

At 0 ms this is the OSRS ideal (a click during tick T acts on T+1); real
ping pushes arrivals across tick boundaries, which is what makes flicks
and dodges late. Packet loss drops the input and logs an `inputDropped`
event.

### Replays and scrubbing

`replay.ts` serializes `{ seed, config, inputs }`. Re-feeding the inputs
into a fresh sim reproduces the run; *scrubbing to tick N* is simply a
re-simulation stopped at N (cheap at fight lengths, and correct by
construction).

## Player offense = the shared calc

The engine does **not** reimplement combat math. Each gear set is priced
once through `calcDps` (`src/engine/formulas.ts`) — the same code the
optimizer uses — and per-swing rolls use that result's max hit, accuracy
and weapon speed. Prayer drain lives in the shared
`src/engine/prayerDrain.ts` (wiki accumulator model: resistance
`2·bonus + 60`).

## File map

| File | What lives there |
|---|---|
| `constants.ts` | every number in the fight, with wiki citations |
| `types.ts` | config / input / event / snapshot shapes |
| `rng.ts` | seedable mulberry32 |
| `hazards.ts` | AoE tile geometry + arena helpers |
| `attackPattern.ts` | rotation state machine |
| `player.ts` | stats, prayer, consumables, movement |
| `engine.ts` | the tick pipeline |
| `replay.ts` | export / import / scrub |
| `results.ts` | event-log → results summary |

## Adding a preset

Presets are **declarative JSON**, not code. Drop a file in
`src/renderer/colosseum/presets/` and list it in
`src/renderer/colosseum/presets.ts` (`PRESET_FILES`):

```jsonc
{
  "name": "My preset",
  "description": "Shown as a tooltip",
  "gear": { "weapon": "Abyssal whip", "head": "Helm of neitiznot" },
  "gearVersions": { "weapon": "" },        // optional version pins
  "attackStyle": "slash",
  "stance": "aggressive",
  "inventory": [ { "item": "shark", "qty": 12 } ],
  "skills": { "atk": 99, "str": 99, "def": 99, "hp": 99,
              "magic": 99, "ranged": 99, "prayer": 99 },
  "settings": { "latency": { "pingMs": 20, "jitterMs": 5, "packetLossPct": 0 } }
}
```

Gear entries are item **names** resolved against the live equipment
database at load time (unknown names warn and are skipped). Inventory
`item` ids come from `CONSUMABLES` in `constants.ts`. Presets are
read-only in the UI — saving forks them into a localStorage profile
(versioned key, migration path in `renderer/colosseum/profiles.ts`).

## Known simplifications (documented in code)

- Sol does not reposition; the arena is an open 16×15 box (no pillars).
- Movement pathing is greedy 8-directional; sand halts a blocked step.
- Special attacks use a small single-roll approximation table
  (`SPEC_TABLE` in `ColosseumTab.tsx`).
- Standing on molten sand deals a small per-tick bite (area denial) rather
  than blocking pathing exactly as in game.
- Doom of Mokhaiotl-style phase-dependent boss states and the wiki's
  crystal wall-lasers outside transitions are not modelled.
