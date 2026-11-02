/**
 * Scene lint CLI. Run from repo root (Node 22.18+/24, no build, no tsx):
 *   node packages/dialogue/src/cli.ts <scene.json | dir> [...] [--strict] [--flags flags.json]
 * All scenes given are linted together: flags set in any scene (plus any `flags.json` registry,
 * an array of flag names, found in the targets or passed with --flags) count as known.
 * Exit 1 on errors (or on warnings with --strict).
 */
import { register } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Source files import './x.js'; let Node map those to the .ts files.
const hooks = `export async function resolve(s, c, n) {
  try { return await n(s, c); } catch (e) {
    if (s.startsWith('.') && s.endsWith('.js')) return n(s.slice(0, -3) + '.ts', c);
    throw e;
  }
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const { lintScenes } = await import('./lint.js');
type Issue = { severity: 'error' | 'warning'; code: string; message: string; nodeId?: string };

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const flagsIdx = args.indexOf('--flags');
const flagsFile = flagsIdx >= 0 ? args[flagsIdx + 1] : undefined;
const targets = args.filter((a, i) => !a.startsWith('--') && !(flagsIdx >= 0 && i === flagsIdx + 1));
if (targets.length === 0) {
  console.error('usage: node packages/dialogue/src/cli.ts <scene.json | dir> [...] [--strict] [--flags flags.json]');
  process.exit(2);
}

const REGISTRY = 'flags.json';
function collect(p: string, acc: string[]): string[] {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) collect(join(p, f), acc);
  } else if (p.endsWith('.json') && !p.endsWith(REGISTRY)) acc.push(p);
  return acc;
}
function registries(p: string, acc: string[]): string[] {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) registries(join(p, f), acc);
  } else if (p.endsWith(REGISTRY)) {
    const v: unknown = JSON.parse(readFileSync(p, 'utf8'));
    if (Array.isArray(v)) acc.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  return acc;
}

const files = targets.flatMap((t) => collect(t, []));
const extraFlags = [...targets.flatMap((t) => registries(t, [])), ...(flagsFile ? registries(flagsFile, []) : [])];
const loaded = files.map((f) => {
  try {
    return { f, scene: JSON.parse(readFileSync(f, 'utf8')) as unknown, parseError: undefined as string | undefined };
  } catch (e) {
    return { f, scene: null as unknown, parseError: (e as Error).message };
  }
});
const ok = loaded.filter((p) => p.parseError === undefined);
const results = lintScenes(ok.map((p) => p.scene), { extraFlags });

let errors = 0;
let warnings = 0;
for (const p of loaded) {
  const issues: Issue[] =
    p.parseError !== undefined
      ? [{ severity: 'error', code: 'parse', message: p.parseError }]
      : (results[ok.indexOf(p)] ?? []);
  for (const i of issues) {
    if (i.severity === 'error') errors++;
    else warnings++;
    console.log(`${p.f}${i.nodeId ? `#${i.nodeId}` : ''} ${i.severity} [${i.code}] ${i.message}`);
  }
}
console.log(`${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);
