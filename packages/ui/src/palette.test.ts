import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import palette from './palette.json';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const declared = new Map([...css.matchAll(/--cf-([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]));

describe('palette lock', () => {
  it('keeps the 12 binding base colours from spec 02 section 3.2', () => {
    expect(Object.fromEntries(Object.entries(palette.base).map(([k, v]) => [k, v.hex]))).toEqual({
      ink: '#14161C', night: '#1F2430', slate: '#2F3A4C', fog: '#8A97A8', paper: '#EDE3CF', brass: '#C79A3B',
      amber: '#E8A33D', teal: '#2FA8A0', blue: '#4F86C6', rust: '#B5543A', olive: '#7C8B4A', phosphor: '#7BE38E',
    });
  });

  it('tokens.css declares exactly the palette.json colours', () => {
    const json = new Map([...Object.entries(palette.base), ...Object.entries(palette.tints)].map(([k, v]) => [k, v.hex]));
    expect(declared).toEqual(json);
  });

  it('quantise list has 24 unique entries, all from the palette', () => {
    const all = new Set([...declared.values()]);
    expect(palette.quantise).toHaveLength(24);
    expect(new Set(palette.quantise).size).toBe(24);
    for (const hex of palette.quantise) expect(all.has(hex)).toBe(true);
  });

  it('approved text pairs meet WCAG AA (4.5:1)', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => {
        const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    for (const [fg, bg] of palette.contrast.approvedText as Array<[string, string, number]>) {
      const a = lum(declared.get(fg)!);
      const b = lum(declared.get(bg)!);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
