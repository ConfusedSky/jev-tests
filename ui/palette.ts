/** What the command palette offers, and which of it a typed query keeps. */
export type Item = {
  id: string;
  group: string;
  label: string;
  /** Shown beside the label; searched too. */
  hint?: string;
  /** Searched, never shown. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
};

/** Items every word of `query` appears in, those whose label starts with it first, then in the order given. */
export function matchItems(items: Item[], query: string, limit = 40): Item[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items.slice(0, limit);
  const scored = items.flatMap((it, order) => {
    const label = it.label.toLowerCase();
    const text = `${label} ${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) return [];
    return [{ it, order, rank: label.startsWith(words[0]!) ? 0 : label.includes(words[0]!) ? 1 : 2 }];
  });
  return scored
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.it);
}
