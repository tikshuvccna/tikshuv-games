import { defineConfig, type UserConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';

export interface DefineGameOptions {
  id: string;
  root: string;
  extra?: UserConfig;
}

function workspaceAliases(root: string): Record<string, string> {
  const pkgDir = resolve(root, '../../packages');
  const out: Record<string, string> = {};
  if (!existsSync(pkgDir)) return out;
  for (const name of readdirSync(pkgDir)) out[`@tikshuv/${name}`] = resolve(pkgDir, name, 'src/index.ts');
  return out;
}

export function defineGame(o: DefineGameOptions) {
  return defineConfig({
    root: o.root,
    base: './',
    publicDir: resolve(o.root, 'public'),
    resolve: { alias: workspaceAliases(o.root) },
    define: { __GAME_ID__: JSON.stringify(o.id), __BUILD__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev') },
    build: {
      outDir: resolve(o.root, '../../dist', o.id),
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
      assetsInlineLimit: 4096,
      chunkSizeWarningLimit: 250,
    },
    ...o.extra,
  });
}
