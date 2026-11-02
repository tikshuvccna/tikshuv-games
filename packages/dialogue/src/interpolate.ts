import { NAME_BUDGET } from './schema.js';

export const PLACEHOLDER = /\{([^{}]*)\}/g;

/** Replace {name} (and any other supplied vars). Unknown tokens are left intact. */
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => {
    const v = vars[key];
    if (v === undefined) return whole;
    return key === 'name' ? [...v].slice(0, NAME_BUDGET).join('') : v;
  });
}
