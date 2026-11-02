import { formatMac, isValidIp } from './addr.js';
import type { Network } from './network.js';
import type { Device, PingResult, TraceResult } from './types.js';

export interface WinResult {
  output: string[];
  prompt: string;
}

const PROMPT = 'C:\\>';

function rttText(ms: number | undefined): string {
  const v = ms ?? 0;
  return v < 1 ? 'time<1ms' : `time=${Math.round(v)}ms`;
}

export function winPingOutput(r: PingResult): string[] {
  const out = ['', `Pinging ${r.target} with ${r.size} bytes of data:`];
  let recv = 0;
  for (const x of r.replies) {
    switch (x.kind) {
      case 'reply':
        out.push(`Reply from ${x.from}: bytes=${r.size} ${rttText(x.rttMs)} TTL=${x.ttl}`);
        break;
      case 'ttl-expired':
        out.push(`Reply from ${x.from}: TTL expired in transit.`);
        break;
      case 'host-unreachable':
      case 'no-route':
        out.push(`Reply from ${x.from}: Destination host unreachable.`);
        break;
      case 'net-unreachable':
        out.push(`Reply from ${x.from}: Destination net unreachable.`);
        break;
      default:
        out.push('Request timed out.');
    }
    // Real Windows counts "Destination unreachable" and "TTL expired" replies as Received [A].
    if (x.kind !== 'timeout') recv++;
  }
  const lost = r.sent - recv;
  out.push('', `Ping statistics for ${r.target}:`, `    Packets: Sent = ${r.sent}, Received = ${recv}, Lost = ${lost} (${Math.round((lost * 100) / (r.sent || 1))}% loss),`);
  if (recv > 0) {
    const t = r.replies.filter((x) => x.kind !== 'timeout').map((x) => Math.floor(x.rttMs ?? 0));
    const avg = Math.round(t.reduce((a, b) => a + b, 0) / t.length);
    out.push('Approximate round trip times in milli-seconds:', `    Minimum = ${Math.min(...t)}ms, Maximum = ${Math.max(...t)}ms, Average = ${avg}ms`);
  }
  return out;
}

export function winTraceOutput(t: TraceResult, maxHops: number): string[] {
  const out = ['', `Tracing route to ${t.target} over a maximum of ${maxHops} hops`, ''];
  for (const h of t.hops) {
    const cells = h.probes.map((p) => {
      if (p.kind === 'timeout' || p.kind === 'no-route') return '*';
      return p.rttMs === undefined || p.rttMs < 1 ? '<1 ms' : `${Math.round(p.rttMs)} ms`;
    });
    const num = String(h.ttl).padStart(3);
    const last = h.probes.find((p) => p.from)?.kind;
    let tail: string;
    if (!h.addr) tail = 'Request timed out.';
    else if (last === 'host-unreachable') tail = `${h.addr}  reports: Destination host unreachable.`;
    else if (last === 'net-unreachable') tail = `${h.addr}  reports: Destination net unreachable.`;
    else tail = h.addr;
    out.push(`${num}  ${cells.map((c) => c.padStart(6)).join(' ')}  ${tail}`);
  }
  out.push('', 'Trace complete.');
  return out;
}

/** Windows command prompt over a host: ipconfig, arp -a, ping, tracert. */
export class WindowsCli {
  private readonly dev: Device;

  constructor(
    private readonly net: Network,
    deviceName: string,
  ) {
    this.dev = net.device(deviceName);
    if (this.dev.kind !== 'host') throw new Error('WindowsCli needs a host');
  }

  prompt(): string {
    return PROMPT;
  }

  /** Tab completion of the command word only. */
  complete(line: string): { line: string; candidates: string[] } {
    if (/\s/.test(line) || line === '') return { line, candidates: [] };
    const hits = ['arp', 'hostname', 'ipconfig', 'ping', 'tracert'].filter((c) => c.startsWith(line.toLowerCase()));
    return { line: hits.length === 1 ? `${hits[0]} ` : line, candidates: hits };
  }

  exec(line: string): WinResult {
    const t = line.trim().split(/\s+/).filter(Boolean);
    const cmd = (t[0] ?? '').toLowerCase();
    const rest = t.slice(1);
    const done = (output: string[]): WinResult => ({ output, prompt: PROMPT });
    switch (cmd) {
      case '':
        return done([]);
      case 'ipconfig':
        return done(this.ipconfig(rest.some((a) => a.toLowerCase() === '/all')));
      case 'arp':
        return done(this.arp(rest));
      case 'ping':
        return done(this.ping(rest));
      case 'tracert':
        return done(this.tracert(rest));
      case 'hostname':
        return done([this.dev.hostname]);
      default:
        return done([`'${t[0]}' is not recognized as an internal or external command,`, 'operable program or batch file.']);
    }
  }

  private ipconfig(all: boolean): string[] {
    const out = ['', 'Windows IP Configuration', ''];
    if (all) out.push(`   Host Name . . . . . . . . . . . . : ${this.dev.hostname}`, '   Primary Dns Suffix  . . . . . . . : ', '   Node Type . . . . . . . . . . . . : Hybrid', '   IP Routing Enabled. . . . . . . . : No', '');
    for (const i of this.dev.ifaces) {
      const adapter = i.name.replace(/\d+$/, '') || i.name;
      out.push(`Ethernet adapter ${adapter}:`, '');
      if (!this.net.isUp(i)) {
        out.push('   Media State . . . . . . . . . . . : Media disconnected', '   Connection-specific DNS Suffix  . : ', '');
        continue;
      }
      out.push('   Connection-specific DNS Suffix  . : ');
      if (all) {
        out.push(`   Description . . . . . . . . . . . : ${i.name}`, `   Physical Address. . . . . . . . . : ${formatMac(i.mac, 'windows')}`, '   DHCP Enabled. . . . . . . . . . . : No', '   Autoconfiguration Enabled . . . . : Yes');
      }
      out.push(`   IPv4 Address. . . . . . . . . . . : ${i.ip ?? ''}${all && i.ip ? '(Preferred)' : ''}`, `   Subnet Mask . . . . . . . . . . . : ${i.mask ?? ''}`, `   Default Gateway . . . . . . . . . : ${this.dev.gateway ?? ''}`, '');
    }
    return out;
  }

  private arp(a: string[]): string[] {
    const flag = (a[0] ?? '').toLowerCase();
    if (flag === '-d') {
      this.net.clearArp(this.dev);
      return [];
    }
    if (flag !== '-a') return ['', 'Displays and modifies the IP-to-Physical address translation tables used by', 'address resolution protocol (ARP).', '', 'ARP -s inet_addr eth_addr [if_addr]', 'ARP -d inet_addr [if_addr]', 'ARP -a [inet_addr] [-N if_addr] [-v]'];
    const entries = this.net.arpTableOf(this.dev);
    if (entries.length === 0) return ['', 'No ARP Entries Found.'];
    const out: string[] = [];
    // Windows groups by local interface [A: broadcast/multicast static rows are not listed].
    for (const i of this.dev.ifaces) {
      const mine = entries.filter((e) => e.iface === i.name);
      if (mine.length === 0 || !i.ip) continue;
      out.push('', `Interface: ${i.ip} --- 0x${(this.dev.ifaces.indexOf(i) + 4).toString(16)}`, '  Internet Address      Physical Address      Type');
      for (const e of mine) out.push(`  ${e.ip.padEnd(22)}${formatMac(e.mac, 'windows').padEnd(22)}dynamic`);
    }
    return out;
  }

  private ping(a: string[]): string[] {
    let count = 4;
    let ttl: number | undefined;
    let target: string | undefined;
    for (let i = 0; i < a.length; i++) {
      const f = (a[i] as string).toLowerCase();
      if (f === '-n') count = Math.max(1, Number(a[++i]) || 4);
      else if (f === '-i') ttl = Number(a[++i]) || undefined;
      else target = a[i];
    }
    if (!target) return ['', 'Usage: ping [-n count] [-i TTL] target_name'];
    if (!isValidIp(target)) return ['', `Ping request could not find host ${target}. Please check the name and try again.`];
    return winPingOutput(this.net.ping(this.dev.name, target, { count, ttl, timeoutMs: 4000, size: 32 }));
  }

  private tracert(a: string[]): string[] {
    let max = 30;
    let target: string | undefined;
    for (let i = 0; i < a.length; i++) {
      if ((a[i] as string).toLowerCase() === '-h') max = Math.max(1, Number(a[++i]) || 30);
      else target = a[i];
    }
    if (!target) return ['', 'Usage: tracert [-h maximum_hops] target_name'];
    if (!isValidIp(target)) return ['', `Unable to resolve target system name ${target}.`];
    return winTraceOutput(this.net.traceroute(this.dev.name, target, { maxHops: max, probes: 3 }), max);
  }
}
