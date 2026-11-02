/** Small command-grammar engine: keyword abbreviation, argument slots, `?` help, tab completion, IOS-style errors. */

export interface CmdNode {
  /** Keyword text, or the placeholder shown in help for an argument (`A.B.C.D`). */
  word: string;
  help: string;
  /** Present on argument nodes. */
  arg?: {
    match: (token: string) => boolean;
    /** Consume every remaining token, joined with this string. */
    greedy?: string;
  };
  children?: CmdNode[];
  run?: (args: string[]) => string[] | void;
}

export interface Tok {
  text: string;
  col: number;
}

export type CliErrorKind = 'invalid' | 'incomplete' | 'ambiguous';

export interface CliError {
  kind: CliErrorKind;
  /** 0-based column inside the typed line where the problem starts (the `^` marker position, without prompt). */
  column: number;
  /** Ready-to-print message, e.g. `% Invalid input detected at '^' marker.` */
  message: string;
}

export const kw = (word: string, help: string, children?: CmdNode[], run?: CmdNode['run']): CmdNode => ({ word, help, children, run });

export const arg = (
  word: string,
  help: string,
  match: (t: string) => boolean,
  children?: CmdNode[],
  run?: CmdNode['run'],
  greedy?: string,
): CmdNode => ({ word, help, arg: { match, greedy }, children, run });

export function tokenize(line: string, offset = 0): Tok[] {
  const out: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ text: m[0], col: m.index + offset });
  return out;
}

export type WalkResult =
  | { ok: true; node: CmdNode | null; children: CmdNode[]; args: string[] }
  | { ok: false; error: CliError };

export const invalidInput = (column: number): CliError => ({ kind: 'invalid', column, message: "% Invalid input detected at '^' marker." });

/** Match a typed token against sibling keywords: exact wins, otherwise unique prefix. */
function matchKeyword(children: readonly CmdNode[], tok: string): CmdNode[] {
  const t = tok.toLowerCase();
  const kws = children.filter((c) => !c.arg);
  const exact = kws.filter((c) => c.word === t);
  if (exact.length === 1) return exact;
  return kws.filter((c) => c.word.startsWith(t));
}

/** Walk the grammar tree along the tokens. */
export function walk(root: readonly CmdNode[], toks: readonly Tok[], line: string): WalkResult {
  let children: readonly CmdNode[] = root;
  let node: CmdNode | null = null;
  const args: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i] as Tok;
    const hits = matchKeyword(children, tok.text);
    if (hits.length > 1) {
      const upto = line.slice(0, tok.col + tok.text.length).trim();
      return { ok: false, error: { kind: 'ambiguous', column: tok.col, message: `% Ambiguous command:  "${upto}"` } };
    }
    let next: CmdNode | undefined = hits[0];
    if (!next) {
      const a = children.find((c) => c.arg);
      if (a?.arg) {
        const greedy = a.arg.greedy;
        if (greedy !== undefined) {
          const joined = toks.slice(i).map((t) => t.text).join(greedy);
          if (!a.arg.match(joined)) return { ok: false, error: invalidInput(tok.col) };
          args.push(joined);
          node = a;
          children = a.children ?? [];
          break;
        }
        if (a.arg.match(tok.text)) {
          args.push(tok.text);
          next = a;
        }
      }
    }
    if (!next) return { ok: false, error: invalidInput(tok.col) };
    node = next;
    children = next.children ?? [];
  }
  return { ok: true, node, children: [...children], args };
}

export const incomplete = (column: number): CliError => ({ kind: 'incomplete', column, message: '% Incomplete command.' });

/** Help for `?`: next-token options after a trailing space, or words starting with the partial token. */
export function helpLines(root: readonly CmdNode[], line: string): string[] {
  const trailing = line.length === 0 || /\s$/.test(line);
  const toks = tokenize(line);
  const complete = trailing ? toks : toks.slice(0, -1);
  const w = walk(root, complete, line);
  if (!w.ok) return [w.error.message];
  if (trailing) {
    const rows: [string, string][] = w.children.map((c) => [c.word, c.help]);
    if (w.node?.run) rows.unshift(['<cr>', '']);
    if (rows.length === 0) return ['% Unrecognized command'];
    const width = Math.max(...rows.map((r) => r[0].length)) + 2;
    return rows.map(([a, b]) => `  ${a.padEnd(width)}${b}`.trimEnd());
  }
  const partial = (toks[toks.length - 1] as Tok).text;
  const hits = w.children.filter((c) => !c.arg && c.word.startsWith(partial.toLowerCase()));
  if (hits.length === 0) {
    const a = w.children.find((c) => c.arg?.match(partial));
    return a ? [`  ${a.word}  ${a.help}`] : ['% Unrecognized command'];
  }
  return [hits.map((h) => h.word).join('  ')];
}

export interface Completion {
  line: string;
  candidates: string[];
}

/** Tab completion of the last token. */
export function complete(root: readonly CmdNode[], line: string): Completion {
  const trailing = line.length === 0 || /\s$/.test(line);
  if (trailing) return { line, candidates: [] };
  const toks = tokenize(line);
  const last = toks[toks.length - 1] as Tok;
  const w = walk(root, toks.slice(0, -1), line);
  if (!w.ok) return { line, candidates: [] };
  const hits = w.children.filter((c) => !c.arg && c.word.startsWith(last.text.toLowerCase()));
  if (hits.length === 0) return { line, candidates: [] };
  const prefix = line.slice(0, last.col);
  if (hits.length === 1) return { line: `${prefix}${(hits[0] as CmdNode).word} `, candidates: [(hits[0] as CmdNode).word] };
  let common = (hits[0] as CmdNode).word;
  for (const h of hits) while (!h.word.startsWith(common)) common = common.slice(0, -1);
  return { line: prefix + (common.length > last.text.length ? common : last.text), candidates: hits.map((h) => h.word) };
}
