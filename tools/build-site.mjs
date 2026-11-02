// Builds every game in games/* and assembles dist/ with a landing page.
import { readdirSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const gamesDir = resolve(root, 'games');
const games = readdirSync(gamesDir).filter((g) => existsSync(resolve(gamesDir, g, 'vite.config.ts')));

for (const g of games) {
  console.log(`building ${g}`);
  execSync(`npm -w games/${g} run build`, { cwd: root, stdio: 'inherit' });
}

const titles = JSON.parse(readFileSync(resolve(root, 'games.json'), 'utf8'));
const items = games
  .map((g) => `<li><a href="./${g}/">${titles[g]?.title ?? g}</a><p>${titles[g]?.blurb ?? ''}</p></li>`)
  .join('\n');
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(
  resolve(root, 'dist/index.html'),
  `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>משחקי תקשוב</title>
<style>body{margin:0;background:#1F2430;color:#EDE3CF;font-family:system-ui,sans-serif;padding:2rem 16px}h1{color:#C79A3B}li{margin:1rem 0;list-style:none}a{color:#E8A33D;font-size:1.3rem}</style></head>
<body><h1>משחקי תקשוב</h1><ul>${items}</ul></body></html>`,
);
console.log(`site ready: ${games.length} game(s)`);
