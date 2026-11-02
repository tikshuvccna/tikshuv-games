import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasErrors, lintScene } from '@tikshuv/dialogue';
import { isCaseUnlocked } from '@tikshuv/save';
import { CASES, CASE_UNITS, CODEX, DEDUCTIONS, EVIDENCE, PLACES, SCENE_SOURCES, THOUGHTS, UNITS, gradeFor } from './catalog';
import { hasKey } from './i18n';
import { autoLtr } from './rich';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('design-system.ts') ? [p] : [];
  });
}

describe('game content', () => {
  it('every scene lints clean against the content registries', () => {
    for (const [id, raw] of Object.entries(SCENE_SOURCES)) {
      const issues = lintScene(raw, { evidenceIds: Object.keys(EVIDENCE), thoughtIds: Object.keys(THOUGHTS) });
      expect(hasErrors(issues), `${id}: ${JSON.stringify(issues)}`).toBe(false);
    }
  });

  it('catalog references resolve', () => {
    for (const c of CASES) for (const u of c.units) expect(UNITS[u], u).toBeDefined();
    for (const p of Object.values(PLACES)) for (const hs of p.hotspots) if (hs.evidenceId) expect(EVIDENCE[hs.evidenceId]).toBeDefined();
    for (const d of Object.values(DEDUCTIONS)) for (const r of d.requires) expect(EVIDENCE[r]).toBeDefined();
    for (const e of CODEX) expect(UNITS[e.unit]).toBeDefined();
    for (const th of Object.values(THOUGHTS)) expect(th.apply.answer).toBeLessThan(th.apply.options.length);
  });

  it('case lock/unlock follows the derived rules', () => {
    expect(isCaseUnlocked('prologue', {}, CASE_UNITS, {})).toBe(true);
    expect(isCaseUnlocked('case1', {}, CASE_UNITS, {})).toBe(false);
    expect(isCaseUnlocked('case1', {}, CASE_UNITS, { prologue: { solved: true } })).toBe(true);
    expect(isCaseUnlocked('case2', {}, CASE_UNITS, {})).toBe(false);
    expect(CASES.map((c) => c.id)).toEqual(['prologue', 'case1', 'case2', 'case3', 'case4', 'case5', 'finale']);
  });

  it('maps scene moods to a colour grade', () => {
    expect(gradeFor('mood_terminal')).toBe('terminal');
    expect(gradeFor('mood_check_red')).toBe('suspicion');
    expect(gradeFor('mood_hub')).toBe('bureau');
  });

  it('wraps Latin tokens in LTR islands', () => {
    expect(autoLtr('וה-MAC')).toBe('וה-<ltr>MAC</ltr>');
    expect(autoLtr('כבר <ltr>IP</ltr>')).toBe('כבר <ltr>IP</ltr>');
  });
});

describe('i18n', () => {
  it('every literal t() key used by the code exists in ui.json', () => {
    const missing: string[] = [];
    for (const file of sources(join(import.meta.dirname))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*(?:\w+\s*\?\s*)?'([a-zA-Z0-9_.]+)'(?:\s*:\s*'([a-zA-Z0-9_.]+)')?/g)) {
        for (const key of [m[1], m[2]]) if (key && !hasKey(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('code has no Hebrew literals', () => {
    const bad: string[] = [];
    for (const file of sources(join(import.meta.dirname))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
        if (/[֐-׿]/.test(l)) bad.push(`${file}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
