/**
 * Where the shelf's PDFs come from: a folder, walked for every PDF under it,
 * or a locate command, whose output is the list. A command is split into
 * words here and run without a shell, so it can only ever be plocate.
 */
export const LOCATORS = ["plocate", "locate", "mlocate"];

export const quote = (s: string) => (/^[\w./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The words a POSIX shell would split `line` into, quotes and backslashes and all; anything a shell would expand is refused. */
export function shellWords(line: string): string[] | { error: string } {
  const needsShell = (c: string) => ({ error: `${c} needs a shell, and the shelf runs plocate without one: give it only its options and patterns` });
  const words: string[] = [];
  let word: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return { error: "a ' is not closed" };
      word = (word ?? "") + line.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      word ??= "";
      for (i++; i < line.length && line[i] !== '"'; i++) {
        if (line[i] === "$" || line[i] === "`") return needsShell(line[i]!);
        if (line[i] === "\\" && /["\\]/.test(line[i + 1] ?? "")) i++;
        word += line[i];
      }
      if (i >= line.length) return { error: 'a " is not closed' };
    } else if (c === "\\") {
      word = (word ?? "") + (line[++i] ?? "");
    } else if (/\s/.test(c)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (/[|;&<>`$()]/.test(c)) return needsShell(c);
    else word = (word ?? "") + c;
  }
  if (word !== undefined) words.push(word);
  return words;
}

export const isLocate = (source: string) => LOCATORS.includes(source.trim().split(/\s+/)[0] ?? "");

/** The command's words, first the locator and then what it is given, or why it will not run. */
export function locateArgs(source: string): { argv: string[] } | { error: string } {
  const words = shellWords(source.trim());
  if ("error" in words) return words;
  if (!LOCATORS.includes(words[0] ?? "")) return { error: `start with ${LOCATORS.join(" or ")}` };
  if (words.length < 2) return { error: `give ${words[0]} a pattern, e.g. ${words[0]} -i '*.pdf'` };
  return { argv: words };
}

/** Why a locate command found nothing, when its words say: plocate matches a pattern holding a wildcard against the whole path. */
export function locateHint(source: string): string | undefined {
  const a = locateArgs(source);
  const glob = "argv" in a ? a.argv.slice(1).find((w) => !w.startsWith("-") && /[*?[]/.test(w) && !/^[*/]/.test(w)) : undefined;
  return glob && `a pattern with a wildcard must match the whole path, so try ${quote(`*${glob}`)}`;
}

/** A source as the shelf keeps and shows it: a locate command re-quoted from its words, so what is shown is what runs. */
export function sourceKey(source: string): string {
  const a = locateArgs(source);
  return "argv" in a ? a.argv.map(quote).join(" ") : source.trim();
}

/** Shell text that prints the shelf's paths, the way the tools read them on stdin; sources that overlap list a PDF once, as the shelf does. */
export function feed(sources: string[]): string {
  const folders = sources.filter((s) => !isLocate(s));
  const parts = [...(folders.length ? [`find ${folders.map(quote).join(" ")} -iname '*.pdf'`] : []), ...sources.filter(isLocate).map(sourceKey)];
  if (parts.length === 0) return "find . -iname '*.pdf'";
  return parts.length === 1 ? parts[0]! : `{ ${parts.join("; ")}; } | sort -u`;
}
