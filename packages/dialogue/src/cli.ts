/**
 * Scene lint CLI. Run from repo root (Node 22.18+/24, no build, no tsx):
 *   node packages/dialogue/src/cli.ts <scene.json | dir> [...] [--strict]
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

const { lintScene } = await import('./lint.js');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targets = args.filter((a) => !a.startsWith('--'));
if (targets.length === 0) {
  console.error('usage: node packages/dialogue/src/cli.ts <scene.json | dir> [...] [--strict]');
  process.exit(2);
}

function collect(p: string, acc: string[]): string[] {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) collect(join(p, f), acc);
  } else if (p.endsWith('.json')) acc.push(p);
  return acc;
}

let errors = 0;
let warnings = 0;
for (const f of targets.flatMap((t) => collect(t, []))) {
  let issues;
  try {
    issues = lintScene(JSON.parse(readFileSync(f, 'utf8')));
  } catch (e) {
    issues = [{ severity: 'error' as const, code: 'parse', message: (e as Error).message }];
  }
  for (const i of issues) {
    if (i.severity === 'error') errors++;
    else warnings++;
    console.log(`${f}${i.nodeId ? `#${i.nodeId}` : ''} ${i.severity} [${i.code}] ${i.message}`);
  }
}
console.log(`${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);
