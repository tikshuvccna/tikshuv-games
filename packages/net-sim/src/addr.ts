/** IPv4 and MAC helpers. Pure functions, no state. */

export function parseIp(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const part = m[i] as string;
    const v = Number(part);
    if (v > 255 || (part.length > 1 && part.startsWith('0'))) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function ipToString(n: number): string {
  const u = n >>> 0;
  return [u >>> 24, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join('.');
}

export function isValidIp(s: string): boolean {
  return parseIp(s) !== null;
}

/** Prefix length (0..32) to dotted mask number. */
export function prefixToMaskNum(prefix: number): number {
  if (prefix <= 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixToMask(prefix: number): string {
  return ipToString(prefixToMaskNum(prefix));
}

/** Dotted mask to prefix length; null when not a contiguous mask. */
export function maskToPrefix(mask: string): number | null {
  const n = parseIp(mask);
  if (n === null) return null;
  let ones = 0;
  let i = 31;
  while (i >= 0 && ((n >>> i) & 1) === 1) {
    ones++;
    i--;
  }
  while (i >= 0) {
    if (((n >>> i) & 1) === 1) return null;
    i--;
  }
  return ones;
}

export function isValidMask(mask: string): boolean {
  return maskToPrefix(mask) !== null;
}

export function networkOf(ip: string, mask: string): string {
  const a = parseIp(ip);
  const m = parseIp(mask);
  if (a === null || m === null) throw new Error(`bad address ${ip}/${mask}`);
  return ipToString((a & m) >>> 0);
}

export function broadcastOf(ip: string, mask: string): string {
  const a = parseIp(ip);
  const m = parseIp(mask);
  if (a === null || m === null) throw new Error(`bad address ${ip}/${mask}`);
  return ipToString(((a & m) | ~m) >>> 0);
}

export function sameSubnet(a: string, b: string, mask: string): boolean {
  return networkOf(a, mask) === networkOf(b, mask);
}

/** A usable host address: not the network address and not the subnet broadcast (prefix < 31). */
export function isHostAddress(ip: string, mask: string): boolean {
  const p = maskToPrefix(mask);
  if (p === null || parseIp(ip) === null) return false;
  if (p >= 31) return true;
  return ip !== networkOf(ip, mask) && ip !== broadcastOf(ip, mask);
}

export function hostCount(mask: string): number {
  const p = maskToPrefix(mask);
  if (p === null) return 0;
  if (p >= 31) return p === 32 ? 1 : 2;
  return 2 ** (32 - p) - 2;
}

export function firstHost(ip: string, mask: string): string {
  return ipToString((parseIp(networkOf(ip, mask)) as number) + 1);
}

export function lastHost(ip: string, mask: string): string {
  return ipToString((parseIp(broadcastOf(ip, mask)) as number) - 1);
}

/** "192.168.1.0/24" to {network, mask, prefix}; null when invalid. */
export function parseCidr(s: string): { network: string; mask: string; prefix: number } | null {
  const [ip, p, extra] = s.split('/');
  if (ip === undefined || p === undefined || extra !== undefined || !/^\d{1,2}$/.test(p)) return null;
  const prefix = Number(p);
  if (prefix > 32 || parseIp(ip) === null) return null;
  const mask = prefixToMask(prefix);
  return { network: networkOf(ip, mask), mask, prefix };
}

export type IpClass = 'A' | 'B' | 'C' | 'D' | 'E';
/** Classful range (A: 1-126, 127 loopback treated as A) [A: class A boundary 126 vs 127 unconfirmed]. */
export function ipClass(ip: string): IpClass | null {
  const n = parseIp(ip);
  if (n === null) return null;
  const first = n >>> 24;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D';
  return 'E';
}

export function isApipa(ip: string): boolean {
  return ip.startsWith('169.254.');
}

// ---- MAC ----

export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';

/** Normalise any common MAC notation (aa-bb-.., aa:bb:.., aabb.ccdd.eeff) to lowercase colon form; null if invalid. */
export function normalizeMac(s: string): string | null {
  const hex = s.trim().toLowerCase().replace(/[-:.]/g, '');
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  if (!/^([0-9a-f]{2}[-:]){5}[0-9a-f]{2}$|^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$|^[0-9a-f]{12}$/i.test(s.trim())) return null;
  return hex.match(/../g)!.join(':');
}

export type MacStyle = 'colon' | 'windows' | 'cisco';

export function formatMac(mac: string, style: MacStyle = 'colon'): string {
  const hex = mac.replace(/:/g, '');
  if (style === 'windows') return hex.match(/../g)!.join('-').toUpperCase();
  if (style === 'cisco') return hex.match(/..../g)!.join('.');
  return mac;
}

export function isBroadcastMac(mac: string): boolean {
  return mac === BROADCAST_MAC;
}

/** Deterministic MAC from an OUI prefix and a counter. */
export function makeMac(oui: string, n: number): string {
  const tail = (n & 0xffffff).toString(16).padStart(6, '0');
  return `${oui}:${tail.slice(0, 2)}:${tail.slice(2, 4)}:${tail.slice(4, 6)}`;
}
