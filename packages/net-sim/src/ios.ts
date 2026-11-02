import {
  formatMac,
  isHostAddress,
  isValidIp,
  isValidMask,
  maskToPrefix,
  networkOf,
} from './addr.js';
import { arg, complete, helpLines, incomplete, kw, tokenize, walk, type CliError, type CmdNode, type Completion } from './cli-core.js';
import { findIface, shortIfName } from './ifnames.js';
import type { Network } from './network.js';
import type { Device, Iface, PingResult, TraceResult } from './types.js';

export type IosMode = 'user' | 'priv' | 'config' | 'config-if';

export interface CliResult {
  /** Output lines (no DOM, no HTML). For errors the caret line and message are already included. */
  output: string[];
  error?: CliError;
  mode: IosMode;
  prompt: string;
  /** True when `exit`/`logout` was typed at the top level (terminal should close). */
  closed?: boolean;
}

const pad = (s: string, n: number): string => s.padEnd(n);

export function iosPingOutput(r: PingResult, ip: string): string[] {
  const chars = r.replies
    .map((x) => {
      switch (x.kind) {
        case 'reply':
          return '!';
        case 'host-unreachable':
          return 'U';
        case 'net-unreachable':
          return 'N';
        case 'ttl-expired':
          return '&';
        default:
          return '.';
      }
    })
    .join('');
  const pct = r.sent === 0 ? 0 : Math.floor((r.received * 100) / r.sent);
  let last = `Success rate is ${pct} percent (${r.received}/${r.sent})`;
  if (r.received > 0) last += `, round-trip min/avg/max = ${Math.round(r.rttMin ?? 0)}/${Math.round(r.rttAvg ?? 0)}/${Math.round(r.rttMax ?? 0)} ms`;
  return ['Type escape sequence to abort.', `Sending ${r.sent}, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`, chars, last];
}

export function iosTraceOutput(t: TraceResult): string[] {
  const out = ['Type escape sequence to abort.', `Tracing the route to ${t.target}`, ''];
  for (const h of t.hops) {
    const cells = h.probes.map((p) => {
      if (p.kind === 'timeout' || p.kind === 'no-route') return '*';
      if (p.kind === 'host-unreachable') return '!H';
      if (p.kind === 'net-unreachable') return '!N';
      return `${Math.round(p.rttMs ?? 0)} msec`;
    });
    const num = String(h.ttl).padStart(3);
    out.push(h.addr ? `${num} ${h.addr} ${cells.join(' ')}` : `${num}  ${cells.join('  ')}`);
  }
  return out;
}

/** IOS-like interpreter over a router or switch. */
export class IosCli {
  mode: IosMode = 'user';
  private sel?: Iface;
  private startup: string[] | null = null;
  private readonly dev: Device;

  constructor(
    private readonly net: Network,
    deviceName: string,
  ) {
    this.dev = net.device(deviceName);
    if (this.dev.kind === 'host') throw new Error('IosCli needs a router or switch');
  }

  get device(): Device {
    return this.dev;
  }

  prompt(): string {
    const h = this.dev.hostname;
    switch (this.mode) {
      case 'user':
        return `${h}>`;
      case 'priv':
        return `${h}#`;
      case 'config':
        return `${h}(config)#`;
      case 'config-if':
        return `${h}(config-if)#`;
    }
  }

  // ---------- public API ----------

  /** Execute one line. A trailing `?` returns help instead (as on a real terminal). */
  exec(line: string): CliResult {
    if (line.trimEnd().endsWith('?')) return this.result(this.help(line.trimEnd().slice(0, -1)));
    return this.run(line);
  }

  /** `?` help lines for a partial line. */
  help(line: string): string[] {
    if ((this.mode === 'config' || this.mode === 'config-if') && /^\s*do\s/i.test(line)) return helpLines(this.tree('priv'), line.replace(/^\s*do\s+/i, ''));
    return helpLines(this.tree(this.mode), line);
  }

  /** Tab completion of the last word. */
  complete(line: string): Completion {
    return complete(this.tree(this.mode), line);
  }

  // ---------- internals ----------

  private result(output: string[], error?: CliError, closed?: boolean): CliResult {
    return { output, error, mode: this.mode, prompt: this.prompt(), closed };
  }

  private isDo(toks: { text: string }[]): boolean {
    return (this.mode === 'config' || this.mode === 'config-if') && toks[0]?.text.toLowerCase() === 'do' && toks.length > 1;
  }

  private run(line: string): CliResult {
    const promptLen = this.prompt().length;
    if (line.trim() === '') return this.result([]);
    let toks = tokenize(line);
    let tree = this.tree(this.mode);
    if (this.isDo(toks)) {
      toks = toks.slice(1);
      tree = this.tree('priv');
    }
    let w = walk(tree, toks, line);
    if (!w.ok && this.mode === 'config-if' && w.error.column === (toks[0]?.col ?? 0)) {
      // like IOS: global config commands are accepted from interface mode and drop back to config mode
      const g = walk(this.tree('config'), toks, line);
      if (g.ok && g.node?.run) {
        w = g;
        this.mode = 'config';
        this.sel = undefined;
      }
    }
    const fail = (e: CliError): CliResult => {
      const lines: string[] = [];
      if (e.kind === 'invalid') lines.push(`${' '.repeat(promptLen + e.column)}^`);
      lines.push(e.message);
      return this.result(lines, e);
    };
    if (!w.ok) return fail(w.error);
    if (!w.node?.run) return fail(incomplete(line.length));
    this.closed = false;
    const out = w.node.run(w.args) ?? [];
    return this.result(out, undefined, this.closed);
  }

  private closed = false;

  // ---------- grammar ----------

  private tree(mode: IosMode): CmdNode[] {
    const isSwitch = this.dev.kind === 'switch';
    const ipArg = (label: string, help: string, children?: CmdNode[], run?: CmdNode['run']): CmdNode => arg(label, help, isValidIp, children, run);
    const pingNode = kw('ping', 'Send echo messages', [ipArg('A.B.C.D', 'Destination address', undefined, (a) => this.doPing(a[0] as string))]);
    const traceNode = kw('traceroute', 'Trace route to destination', [ipArg('A.B.C.D', 'Destination address', undefined, (a) => this.doTrace(a[0] as string))]);
    const showNodes: CmdNode[] = [
      kw('arp', 'ARP table', undefined, () => this.showArp()),
      kw('ip', 'IP information', [
        kw('arp', 'IP ARP table', undefined, () => this.showArp()),
        kw('interface', 'IP interface status and configuration', [kw('brief', 'Brief summary of IP status and configuration', undefined, () => this.showIpIntBrief())]),
        ...(isSwitch ? [] : [kw('route', 'IP routing table', undefined, () => this.showIpRoute())]),
      ]),
    ];
    if (isSwitch) {
      showNodes.push(
        kw('mac', 'MAC configuration', [kw('address-table', 'MAC forwarding table', undefined, () => this.showMac())]),
        kw('mac-address-table', 'MAC forwarding table', undefined, () => this.showMac()),
      );
    }
    const userShow = kw('show', 'Show running system information', showNodes);
    const exitNode = kw('exit', 'Exit from the EXEC', undefined, () => this.doExit());
    const common = [kw('enable', 'Turn on privileged commands', undefined, () => this.setMode('priv')), exitNode, kw('logout', 'Exit from the EXEC', undefined, () => this.doExit()), pingNode, traceNode, userShow];

    if (mode === 'user') return common;

    const privShow = kw('show', 'Show running system information', [
      ...showNodes,
      kw('running-config', 'Current operating configuration', undefined, () => this.runningConfig()),
      kw('startup-config', 'Contents of startup configuration', undefined, () => this.startup ?? ['startup-config is not present']),
    ]);
    const save = (): string[] => {
      this.startup = this.configLines();
      return ['Building configuration...', '[OK]'];
    };
    const privBase: CmdNode[] = [
      kw('disable', 'Turn off privileged commands', undefined, () => this.setMode('user')),
      exitNode,
      kw('logout', 'Exit from the EXEC', undefined, () => this.doExit()),
      pingNode,
      traceNode,
      privShow,
      kw('configure', 'Enter configuration mode', [kw('terminal', 'Configure from the terminal', undefined, () => this.enterConfig())]),
      kw('copy', 'Copy from one file to another', [kw('running-config', 'Copy from current system configuration', [kw('startup-config', 'Copy to startup configuration', undefined, save)])]),
      kw('write', 'Write running configuration to memory', [kw('memory', 'Write to NV memory', undefined, save)], save),
      kw('clear', 'Reset functions', [
        kw('arp-cache', 'Clear the entire ARP cache', undefined, () => void this.net.clearArp(this.dev)),
        ...(isSwitch
          ? [kw('mac', 'MAC forwarding table', [kw('address-table', 'MAC forwarding table', [kw('dynamic', 'dynamic entries only', undefined, () => void this.net.clearMacTable(this.dev))])])]
          : []),
      ]),
    ];
    if (mode === 'priv') return privBase;

    // ----- config modes -----
    // `do <exec command>` is handled by the interpreter itself (see run/help), not by the tree.
    const interfaceNode = kw('interface', 'Select an interface to configure', [
      arg('IFACE', 'Interface name, e.g. gigabitEthernet 0/0', (t) => !!findIface(this.dev.ifaces, t), undefined, (a) => this.selectIface(a[0] as string), ''),
    ]);
    const hostnameNode = kw('hostname', 'Set system network name', [
      arg('WORD', 'This system hostname', (t) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(t), undefined, (a) => {
        this.dev.hostname = a[0] as string;
      }),
    ]);
    const maskArg = (children?: CmdNode[], run?: CmdNode['run']): CmdNode => arg('A.B.C.D', 'IP subnet mask', isValidMask, children, run);
    const routeNode = (neg: boolean): CmdNode =>
      kw('route', 'Establish static routes', [
        ipArg('A.B.C.D', 'Destination prefix', [maskArg([ipArg('A.B.C.D', 'Forwarding router address', undefined, (a) => this.setRoute(a as [string, string, string], neg))])]),
      ]);
    const configTop: CmdNode[] = [
      hostnameNode,
      interfaceNode,
      kw('exit', 'Exit from configure mode', undefined, () => this.setMode('priv')),
      kw('end', 'Exit from configure mode', undefined, () => this.setMode('priv')),
      kw('ip', 'Global IP configuration subcommands', [
        ...(isSwitch ? [kw('default-gateway', 'Specify default gateway', [ipArg('A.B.C.D', 'IP address of default gateway', undefined, () => undefined)])] : [routeNode(false)]),
      ]),
      kw('no', 'Negate a command or set its defaults', [
        ...(isSwitch ? [] : [kw('ip', 'Global IP configuration subcommands', [routeNode(true)])]),
      ]),
    ];
    if (mode === 'config') return configTop;

    const speedDuplex = [
      kw('speed', 'Configure speed operation', [arg('SPEED', 'auto, 10 or 100', (t) => ['auto', '10', '100', '1000'].includes(t), undefined, () => undefined)]),
      kw('duplex', 'Configure duplex operation', [arg('MODE', 'auto, full or half', (t) => ['auto', 'full', 'half'].includes(t), undefined, () => undefined)]),
    ];
    const ifNodes: CmdNode[] = [
      kw('shutdown', 'Shutdown the selected interface', undefined, () => this.adminState(false)),
      kw('description', 'Interface specific description', [arg('LINE', 'Up to 240 characters describing this interface', () => true, undefined, (a) => {
        if (this.sel) this.sel.description = a[0] as string;
      }, ' ')]),
      ...speedDuplex,
      interfaceNode,
      kw('exit', 'Exit from interface configuration mode', undefined, () => this.setMode('config')),
      kw('end', 'Exit from configure mode', undefined, () => this.setMode('priv')),
    ];
    const noIf: CmdNode[] = [kw('shutdown', 'Enable the selected interface', undefined, () => this.adminState(true))];
    if (!isSwitch) {
      ifNodes.push(
        kw('ip', 'Interface Internet Protocol config commands', [
          kw('address', 'Set the IP address of an interface', [ipArg('A.B.C.D', 'IP address', [maskArg(undefined, (a) => this.setAddress(a[0] as string, a[1] as string))])]),
          kw('proxy-arp', 'Enable proxy ARP', undefined, () => {
            if (this.sel) this.sel.proxyArp = true;
          }),
        ]),
      );
      noIf.push(
        kw('ip', 'Interface Internet Protocol config commands', [
          kw('address', 'Remove the IP address of an interface', undefined, () => {
            if (this.sel) {
              this.sel.ip = undefined;
              this.sel.mask = undefined;
            }
          }),
          kw('proxy-arp', 'Disable proxy ARP', undefined, () => {
            if (this.sel) this.sel.proxyArp = false;
          }),
        ]),
      );
    }
    ifNodes.push(kw('no', 'Negate a command or set its defaults', noIf));
    return ifNodes;
  }

  // ---------- command bodies ----------

  private setMode(m: IosMode): void {
    this.mode = m;
    if (m !== 'config-if') this.sel = undefined;
  }

  private doExit(): void {
    this.closed = true;
  }

  private enterConfig(): string[] {
    this.mode = 'config';
    return ['Enter configuration commands, one per line.  End with CNTL/Z.'];
  }

  private selectIface(text: string): void {
    this.sel = findIface(this.dev.ifaces, text);
    this.mode = 'config-if';
  }

  private adminState(up: boolean): string[] {
    const i = this.sel;
    if (!i || i.adminUp === up) return [];
    const wasUp = this.net.isUp(i);
    this.net.setAdmin(i, up);
    const isUp = this.net.isUp(i);
    const out: string[] = [];
    if (up && isUp) {
      out.push(`%LINK-5-CHANGED: Interface ${i.name}, changed state to up`, `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${i.name}, changed state to up`);
    } else if (!up) {
      out.push(`%LINK-5-CHANGED: Interface ${i.name}, changed state to administratively down`);
      if (wasUp) out.push(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${i.name}, changed state to down`);
    }
    return out;
  }

  private setAddress(ip: string, mask: string): string[] {
    const i = this.sel;
    if (!i) return [];
    if (!isHostAddress(ip, mask)) return [`Bad mask /${maskToPrefix(mask)} for address ${ip}`];
    const net = networkOf(ip, mask);
    const clash = this.dev.ifaces.find((o) => o !== i && o.ip && o.mask && networkOf(o.ip, o.mask) === net && o.mask === mask);
    if (clash) return [`% ${net} overlaps with ${clash.name}`];
    i.ip = ip;
    i.mask = mask;
    return [];
  }

  private setRoute(a: [string, string, string], remove: boolean): void {
    const [network, mask, nextHop] = a;
    const net = networkOf(network, mask);
    this.dev.routes = this.dev.routes.filter((r) => !(r.network === net && r.mask === mask && r.nextHop === nextHop));
    if (!remove) this.dev.routes.push({ network: net, mask, nextHop });
  }

  private doPing(ip: string): string[] {
    return iosPingOutput(this.net.ping(this.dev.name, ip, { count: 5, timeoutMs: 2000, size: 100 }), ip);
  }

  private doTrace(ip: string): string[] {
    return iosTraceOutput(this.net.traceroute(this.dev.name, ip, { maxHops: 30, probes: 3 }));
  }

  private ifaceStatus(i: Iface): { status: string; proto: string } {
    if (!i.adminUp) return { status: 'administratively down', proto: 'down' };
    return this.net.isUp(i) ? { status: 'up', proto: 'up' } : { status: 'down', proto: 'down' };
  }

  private showIpIntBrief(): string[] {
    const out = ['Interface              IP-Address      OK? Method Status                Protocol'];
    for (const i of this.dev.ifaces) {
      const s = this.ifaceStatus(i);
      out.push(`${pad(i.name, 23)}${pad(i.ip ?? 'unassigned', 16)}YES ${pad(i.ip ? 'manual' : 'unset', 7)}${pad(s.status, 22)}${s.proto}`);
    }
    if (this.dev.kind === 'switch') out.push(`${pad('Vlan1', 23)}${pad('unassigned', 16)}YES ${pad('unset', 7)}${pad('administratively down', 22)}down`);
    return out;
  }

  private showArp(): string[] {
    const entries = this.net.arpTableOf(this.dev);
    const own = this.dev.ifaces.filter((i) => i.ip && this.net.isUp(i));
    if (this.dev.kind === 'switch' || (entries.length === 0 && own.length === 0)) return [];
    const out = ['Protocol  Address          Age (min)  Hardware Addr   Type   Interface'];
    const row = (ip: string, age: string, mac: string, ifn: string): string => `Internet  ${pad(ip, 17)}${age.padStart(9)}   ${pad(formatMac(mac, 'cisco'), 16)}ARPA   ${ifn}`;
    for (const i of own) out.push(row(i.ip as string, '-', i.mac, i.name));
    const now = this.net.now();
    for (const e of entries) {
      out.push(row(e.ip, String(Math.floor((now - e.updatedAt) / 60_000)), e.mac, e.iface));
    }
    return out;
  }

  private showMac(): string[] {
    const out = ['          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----'];
    const rows = this.net.macTableOf(this.dev);
    for (const e of rows) out.push(`${'1'.padStart(4)}    ${pad(formatMac(e.mac, 'cisco'), 18)}${pad('DYNAMIC', 12)}${shortIfName(e.port)}`);
    out.push(`Total Mac Addresses for this criterion: ${rows.length}`);
    return out;
  }

  private showIpRoute(): string[] {
    const out = [
      'Codes: C - connected, S - static, R - RIP, M - mobile, B - BGP',
      '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
      '       * - candidate default, U - per-user static route, o - ODR',
      '',
    ];
    const def = this.dev.routes.find((r) => r.network === '0.0.0.0' && r.mask === '0.0.0.0');
    out.push(def ? `Gateway of last resort is ${def.nextHop} to network 0.0.0.0` : 'Gateway of last resort is not set', '');
    for (const r of this.net.routesOf(this.dev)) {
      const p = maskToPrefix(r.mask);
      if (r.source === 'connected' && r.iface) out.push(`C    ${r.network}/${p} is directly connected, ${r.iface.name}`);
      else if (r.nextHop && this.net.lookupRoute(this.dev, r.nextHop)) out.push(`${r.network === '0.0.0.0' ? 'S*  ' : 'S   '} ${r.network}/${p} [1/0] via ${r.nextHop}`);
    }
    return out;
  }

  private configLines(): string[] {
    const d = this.dev;
    const out = ['!', 'version 15.1', '!', `hostname ${d.hostname}`, '!'];
    for (const i of d.ifaces) {
      out.push(`interface ${i.name}`);
      if (i.description) out.push(` description ${i.description}`);
      if (d.kind === 'router') out.push(i.ip && i.mask ? ` ip address ${i.ip} ${i.mask}` : ' no ip address');
      if (i.proxyArp) out.push(' ip proxy-arp');
      out.push(' duplex auto', ' speed auto');
      if (!i.adminUp) out.push(' shutdown');
      out.push('!');
    }
    if (d.kind === 'switch') out.push('interface Vlan1', ' no ip address', ' shutdown', '!');
    for (const r of d.routes) out.push(`ip route ${r.network} ${r.mask} ${r.nextHop}`);
    if (d.routes.length > 0) out.push('!');
    out.push('end');
    return out;
  }

  private runningConfig(): string[] {
    const body = this.configLines();
    const bytes = body.join('\n').length;
    return ['Building configuration...', '', `Current configuration : ${bytes} bytes`, ...body];
  }
}
