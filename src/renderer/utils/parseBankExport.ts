/**
 * Parses a pasted bank export into a deduped list of OSRS item ids.
 *
 * Targets the common RuneLite "bank export" / "Data Exporter" tab-separated
 * format, where each line starts with the item id:
 *
 *   Item id<TAB>Item name<TAB>Item quantity
 *   9787<TAB>Slayer cape(t)<TAB>1
 *
 * It is deliberately lenient so it also accepts CSV, semicolon, or
 * whitespace-separated pastes: only the FIRST token of each line is read, and
 * a line is kept only if that token is a positive integer. That cleanly skips
 * the header row ("Item id …"), blank lines, and any name-only lines, while
 * leaving names that contain digits — e.g. "Saradomin brew(4)" — untouched
 * (the id is the first token, not the name).
 *
 * Quantity is ignored: owning 1 of an item is the same as owning it for
 * best-in-slot purposes.
 */
export function parseBankItemIds(text: string): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // First field, splitting on tab / comma / semicolon / runs of whitespace.
    const firstToken = line.split(/[\t,;]|\s+/)[0];
    const id = Number(firstToken);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
