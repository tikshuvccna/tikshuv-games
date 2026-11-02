import type { Iface } from './types.js';

const TYPES = [
  { full: 'FastEthernet', short: 'Fa' },
  { full: 'GigabitEthernet', short: 'Gi' },
  { full: 'Ethernet', short: 'Et' },
] as const;

export function shortIfName(name: string): string {
  for (const t of TYPES) if (name.startsWith(t.full)) return t.short + name.slice(t.full.length);
  return name;
}

/** Find an interface by an IOS-style abbreviation: `fa0/1`, `g0/0`, `GigabitEthernet0/0`, `gi 0/1`. */
export function findIface(ifaces: readonly Iface[], text: string): Iface | undefined {
  const m = /^([a-z]+)\s*(\d+(?:\/\d+)*)$/i.exec(text.trim());
  if (!m) return undefined;
  const letters = (m[1] as string).toLowerCase();
  const num = m[2] as string;
  const type = TYPES.find((t) => t.full.toLowerCase().startsWith(letters));
  if (!type) return undefined;
  return ifaces.find((i) => i.name.toLowerCase() === (type.full + num).toLowerCase());
}
