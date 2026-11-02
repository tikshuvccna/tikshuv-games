/** Game strings: one flat Hebrew dictionary (content/he/ui.json). Code never contains Hebrew text. */
import { setUiStrings, uiText } from '@tikshuv/ui';
import ui from '../content/he/ui.json';

const dict: Record<string, string> = { ...ui };

// Kit components (voice names, close buttons...) read the same dictionary.
setUiStrings(dict);

/** Translate a key, replacing {var} tokens. A missing key renders as the key itself (a test fails on it). */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = dict[key] ?? uiText(key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole));
}

/** Add strings at runtime (content packs: cast names etc.). */
export function addStrings(extra: Record<string, string>): void {
  Object.assign(dict, extra);
  setUiStrings(extra);
}

export function hasKey(key: string): boolean {
  return key in dict || uiText(key) !== key;
}
