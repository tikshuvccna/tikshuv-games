export interface Migration {
  from: number;
  to: number;
  migrate(old: Record<string, unknown>): Record<string, unknown>;
}

/** Never delete a migration. Append only. */
export const migrations: Migration[] = [];

export type MigrateResult =
  | { status: 'ok'; data: Record<string, unknown>; migrated: boolean }
  | { status: 'future'; version: number }
  | { status: 'error'; reason: string };

export function migrate(
  input: unknown,
  latest: number,
  chain: readonly Migration[] = migrations,
): MigrateResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { status: 'error', reason: 'not an object' };
  }
  let cur = input as Record<string, unknown>;
  const raw: unknown = cur['v'];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return { status: 'error', reason: 'missing or invalid version' };
  }
  let v: number = raw;
  if (v > latest) return { status: 'future', version: v };
  let migrated = false;
  while (v < latest) {
    const from = v;
    const step = chain.find((m) => m.from === from);
    if (!step) return { status: 'error', reason: `no migration from v${from}` };
    try {
      cur = step.migrate(cur);
    } catch (e) {
      return { status: 'error', reason: `migration v${from} failed: ${String(e)}` };
    }
    v = step.to;
    cur = { ...cur, v };
    migrated = true;
  }
  return { status: 'ok', data: cur, migrated };
}
