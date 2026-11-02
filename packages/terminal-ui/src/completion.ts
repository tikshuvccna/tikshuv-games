export function commonPrefix(words: readonly string[]): string {
  const first = words[0];
  if (first === undefined) return '';
  let end = first.length;
  for (const w of words) {
    let i = 0;
    while (i < end && i < w.length && w[i] === first[i]) i += 1;
    end = i;
  }
  return first.slice(0, end);
}

export type Completion =
  | { kind: 'none'; line: string; candidates: [] }
  | { kind: 'single'; line: string; candidates: string[] }
  | { kind: 'multiple'; line: string; candidates: string[] };

/**
 * Resolve Tab. `candidates` are full-line completions; ones that do not start with `partial`
 * (case-insensitive) are ignored. A single match completes (plus a trailing space); several
 * extend to the common prefix and are listed.
 */
export function complete(partial: string, candidates: readonly string[]): Completion {
  const lower = partial.toLowerCase();
  const matches = [...new Set(candidates.filter((c) => c.toLowerCase().startsWith(lower)))];
  if (matches.length === 0) return { kind: 'none', line: partial, candidates: [] };
  if (matches.length === 1) {
    const only = matches[0] as string;
    return { kind: 'single', line: only.endsWith(' ') ? only : only + ' ', candidates: matches };
  }
  const prefix = commonPrefix(matches);
  return { kind: 'multiple', line: prefix.length > partial.length ? prefix : partial, candidates: matches };
}

/** Returns the partial line without the trailing `?` when the line asks for inline help, else null. */
export function parseHelpRequest(line: string): string | null {
  const t = line.trimEnd();
  if (!t.endsWith('?')) return null;
  return t.slice(0, -1);
}

/** Split multi-line backend output into display lines (drops one trailing newline). */
export function splitOutput(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Next shown-length for a typewriter reveal. */
export function revealSlice(text: string, shown: number, chunk: number): number {
  return Math.min(text.length, shown + Math.max(1, Math.floor(chunk)));
}
