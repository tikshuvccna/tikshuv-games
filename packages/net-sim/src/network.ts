import { createRng, type Rng } from '@tikshuv/core';
import {
  BROADCAST_MAC,
  ipToString,
  isValidIp,
  isValidMask,
  makeMac,
  maskToPrefix,
  networkOf,
  normalizeMac,
  parseIp,
  sameSubnet,
} from './addr.js';
import { findIface, shortIfName } from './ifnames.js';
import type {
  ArpEntry,
  ArpPacket,
  Device,
  DeviceSpec,
  DropReason,
  Frame,
  FrameInfo,
  Iface,
  IcmpMessage,
  IpPacket,
  MacEntry,
  NetworkOptions,
  PingKind,
  PingReply,
  PingResult,
  Route,
  SimEvent,
  SimEventBody,
  TopologySpec,
  TraceHop,
  TraceResult,
} from './types.js';

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

interface Delivery {
  to: Iface;
  frame: Frame;
}

interface PendingPacket {
  pkt: IpPacket;
  origin: 'local' | 'forward';
}

interface Pending {
  device: Device;
  iface: Iface;
  nextHop: string;
  packets: PendingPacket[];
}

interface ProbeOutcome {
  kind: PingKind;
  from?: string;
  ttl?: number;
  t: number;
}

export interface EchoHandle {
  device: string;
  dst: string;
  id: number;
  seq: number;
  t0: number;
}

export interface ResolvedRoute {
  iface: Iface;
  nextHop: string;
  prefix: number;
  source: 'connected' | 'static';
}

const OUI = { host: '00:1a:2b', switch: '00:1b:54', router: '00:1c:58' } as const;

function defaultInterfaces(spec: DeviceSpec): string[] {
  if (spec.kind === 'host') return ['Ethernet0'];
  if (spec.kind === 'router') return ['GigabitEthernet0/0', 'GigabitEthernet0/1'];
  const out: string[] = [];
  for (let i = 1; i <= 24; i++) out.push(`FastEthernet0/${i}`);
  out.push('GigabitEthernet0/1', 'GigabitEthernet0/2');
  return out;
}

/** Full interface name from an abbreviation-free spec name, e.g. `Fa0/1` becomes `FastEthernet0/1`. */
function canonicalIfName(name: string): string {
  const m = /^([a-z]+)\s*(\d+(?:\/\d+)*)$/i.exec(name.trim());
  if (!m) return name;
  const l = (m[1] as string).toLowerCase();
  const num = m[2] as string;
  for (const full of ['FastEthernet', 'GigabitEthernet', 'Ethernet']) {
    if (full.toLowerCase().startsWith(l)) return full + num;
  }
  return name;
}

export class Network {
  readonly devices: Device[] = [];
  /** Ordered event trace of everything that happened since the last `clearTrace`. */
  readonly trace: SimEvent[] = [];
  readonly rng: Rng;
  readonly opts: Required<Omit<NetworkOptions, 'rng' | 'clock'>> & { clock?: () => number };

  private readonly byName = new Map<string, Device>();
  private queue: Delivery[] = [];
  private vtime = 0;
  private seq = 0;
  private frameSeq = 0;
  private packetSeq = 0;
  private pending: Pending[] = [];
  private inbox = new Map<string, ProbeOutcome>();
  private listeners = new Set<(e: SimEvent) => void>();
  private macCounter = { host: 0, switch: 0, router: 0 };

  constructor(spec: TopologySpec, options: NetworkOptions = {}) {
    this.rng = options.rng ?? createRng('net-sim');
    this.opts = {
      clock: options.clock,
      hopMs: options.hopMs ?? 0.05,
      macAgingMs: options.macAgingMs ?? 300_000,
      hostArpTimeoutMs: options.hostArpTimeoutMs ?? 120_000,
      routerArpTimeoutMs: options.routerArpTimeoutMs ?? 14_400_000,
      routerQueuesDuringArp: options.routerQueuesDuringArp ?? false,
      maxSteps: options.maxSteps ?? 20_000,
    };
    for (const d of spec.devices) this.addDevice(d);
    for (const [a, b] of spec.links) this.link(a, b);
  }

  // ---------- construction ----------

  addDevice(spec: DeviceSpec): Device {
    if (this.byName.has(spec.name)) throw new Error(`duplicate device ${spec.name}`);
    const dev: Device = {
      name: spec.name,
      kind: spec.kind,
      hostname: spec.hostname ?? spec.name,
      ifaces: [],
      ttl: spec.ttl ?? (spec.kind === 'host' ? 128 : 255),
      routes: [],
      arp: new Map(),
      macTable: new Map(),
    };
    const ifs = spec.interfaces ?? defaultInterfaces(spec);
    for (const entry of ifs) {
      const is = typeof entry === 'string' ? { name: entry } : entry;
      const name = canonicalIfName(is.name);
      if (dev.ifaces.some((i) => i.name === name)) throw new Error(`duplicate interface ${spec.name}:${name}`);
      const mac = is.mac ? normalizeMac(is.mac) : makeMac(OUI[spec.kind], ++this.macCounter[spec.kind]);
      if (!mac) throw new Error(`bad MAC ${is.mac}`);
      dev.ifaces.push({
        name,
        device: dev,
        mac,
        ip: is.ip,
        mask: is.mask,
        adminUp: is.up ?? spec.kind !== 'router',
        proxyArp: is.proxyArp ?? false,
        description: is.description,
      });
    }
    const first = dev.ifaces[0];
    if (first && spec.ip) {
      first.ip = spec.ip;
      first.mask = spec.mask ?? '255.255.255.0';
    }
    for (const i of dev.ifaces) {
      if (i.ip && (!isValidIp(i.ip) || !i.mask || !isValidMask(i.mask))) throw new Error(`bad address on ${spec.name}:${i.name}`);
    }
    if (spec.gateway) dev.gateway = spec.gateway;
    for (const r of spec.routes ?? []) dev.routes.push({ ...r });
    this.devices.push(dev);
    this.byName.set(dev.name, dev);
    return dev;
  }

  /** Connect two endpoints, `"SW1:Fa0/1"` or a bare device name when it has a single interface. */
  link(a: string, b: string): void {
    const ia = this.endpoint(a);
    const ib = this.endpoint(b);
    if (ia.peer || ib.peer) throw new Error(`interface already linked: ${a} / ${b}`);
    ia.peer = ib;
    ib.peer = ia;
  }

  private endpoint(text: string): Iface {
    const [dn, inm] = text.split(':');
    const dev = this.byName.get(dn ?? '');
    if (!dev) throw new Error(`unknown device in link: ${text}`);
    if (inm === undefined) {
      if (dev.ifaces.length !== 1) throw new Error(`${dev.name} has several interfaces; use "${dev.name}:<iface>"`);
      return dev.ifaces[0] as Iface;
    }
    const i = findIface(dev.ifaces, inm);
    if (!i) throw new Error(`unknown interface ${text}`);
    return i;
  }

  device(name: string): Device {
    const d = this.byName.get(name);
    if (!d) throw new Error(`unknown device ${name}`);
    return d;
  }

  iface(device: string, name: string): Iface {
    const i = findIface(this.device(device).ifaces, name);
    if (!i) throw new Error(`unknown interface ${device}:${name}`);
    return i;
  }

  // ---------- time / events ----------

  now(): number {
    return this.opts.clock ? this.opts.clock() : this.vtime;
  }

  /** Advance virtual time (no-op on an injected clock) and age MAC/ARP tables. */
  tick(ms: number): void {
    if (!this.opts.clock) this.vtime += ms;
    for (const d of this.devices) {
      this.ageMacTable(d);
      this.ageArp(d);
    }
  }

  onEvent(cb: (e: SimEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  clearTrace(): void {
    this.trace.length = 0;
  }

  private emit(e: DistOmit<SimEventBody, never>): void {
    const full = { ...e, seq: ++this.seq, t: this.now() } as SimEvent;
    this.trace.push(full);
    for (const l of this.listeners) l(full);
  }

  // ---------- link / interface state ----------

  isUp(i: Iface): boolean {
    return i.adminUp && !!i.peer && i.peer.adminUp;
  }

  setAdmin(i: Iface, up: boolean): void {
    i.adminUp = up;
  }

  // ---------- stepping ----------

  /** Number of frames currently on the wire. */
  get inFlight(): number {
    return this.queue.length;
  }

  /** Deliver exactly one in-flight frame. Returns false when the wire is empty. */
  step(): boolean {
    const d = this.queue.shift();
    if (!d) return false;
    if (!this.opts.clock) this.vtime += this.opts.hopMs;
    this.receive(d.to, d.frame);
    return true;
  }

  /** Run until the network is quiet (all frames delivered and unanswered ARPs timed out). Returns steps taken. */
  run(maxSteps = this.opts.maxSteps): number {
    let steps = 0;
    for (;;) {
      while (this.queue.length > 0) {
        if (steps >= maxSteps) throw new Error('net-sim: step limit exceeded (forwarding loop?)');
        this.step();
        steps++;
      }
      if (!this.expirePending()) return steps;
    }
  }

  // ---------- frames ----------

  private info(f: Frame): FrameInfo {
    const base: FrameInfo = { frameId: f.id, srcMac: f.srcMac, dstMac: f.dstMac, etherType: f.etherType, summary: '' };
    if (f.arp) {
      base.srcIp = f.arp.senderIp;
      base.dstIp = f.arp.targetIp;
      base.summary =
        f.arp.op === 'request' ? `ARP who has ${f.arp.targetIp}? tell ${f.arp.senderIp}` : `ARP ${f.arp.senderIp} is at ${f.arp.senderMac}`;
    } else if (f.ip) {
      base.packetId = f.ip.id;
      base.srcIp = f.ip.src;
      base.dstIp = f.ip.dst;
      base.ttl = f.ip.ttl;
      base.summary = `ICMP ${f.ip.icmp.type} ${f.ip.src} > ${f.ip.dst} ttl=${f.ip.ttl}`;
    }
    return base;
  }

  private drop(dev: Device, reason: DropReason, frame?: Frame, iface?: Iface): void {
    this.emit({ type: 'drop', device: dev.name, iface: iface?.name, reason, frame: frame ? this.info(frame) : undefined });
  }

  private transmit(iface: Iface, frame: Frame): void {
    if (!this.isUp(iface) || !iface.peer) {
      this.drop(iface.device, 'link-down', frame, iface);
      return;
    }
    this.emit({
      type: 'tx',
      from: { device: iface.device.name, iface: iface.name },
      to: { device: iface.peer.device.name, iface: iface.peer.name },
      frame: this.info(frame),
    });
    this.queue.push({ to: iface.peer, frame });
  }

  private receive(iface: Iface, frame: Frame): void {
    const dev = iface.device;
    if (!this.isUp(iface)) return this.drop(dev, 'link-down', frame, iface);
    if (dev.kind === 'switch') return this.switchReceive(dev, iface, frame);
    if (frame.dstMac !== iface.mac && frame.dstMac !== BROADCAST_MAC) return this.drop(dev, 'dst-mac-mismatch', frame, iface);
    if (frame.etherType === 'arp' && frame.arp) return this.arpReceive(dev, iface, frame.arp);
    if (frame.etherType === 'ipv4' && frame.ip) return this.ipReceive(dev, iface, frame);
    this.drop(dev, 'unsupported', frame, iface);
  }

  // ---------- switch ----------

  private ageMacTable(dev: Device): void {
    const now = this.now();
    for (const [mac, e] of [...dev.macTable]) {
      if (now - e.updatedAt >= this.opts.macAgingMs) {
        dev.macTable.delete(mac);
        this.emit({ type: 'mac-expire', device: dev.name, mac, port: e.port });
      }
    }
  }

  private switchReceive(dev: Device, inIf: Iface, frame: Frame): void {
    this.ageMacTable(dev);
    const now = this.now();
    if (frame.srcMac !== BROADCAST_MAC) {
      const old = dev.macTable.get(frame.srcMac);
      if (!old) {
        dev.macTable.set(frame.srcMac, { mac: frame.srcMac, port: inIf.name, updatedAt: now });
        this.emit({ type: 'mac-learn', device: dev.name, mac: frame.srcMac, port: inIf.name, action: 'add' });
      } else if (old.port !== inIf.name) {
        dev.macTable.set(frame.srcMac, { mac: frame.srcMac, port: inIf.name, updatedAt: now });
        this.emit({ type: 'mac-learn', device: dev.name, mac: frame.srcMac, port: inIf.name, action: 'move' });
      } else {
        old.updatedAt = now;
      }
    }
    const flood = (reason: 'broadcast' | 'unknown-unicast'): void => {
      const outs = dev.ifaces.filter((i) => i !== inIf && this.isUp(i));
      this.emit({ type: 'switch', device: dev.name, inPort: inIf.name, outPorts: outs.map((i) => i.name), mode: 'flood', reason });
      for (const o of outs) this.transmit(o, frame);
    };
    if (frame.dstMac === BROADCAST_MAC) return flood('broadcast');
    const e = dev.macTable.get(frame.dstMac);
    if (!e) return flood('unknown-unicast');
    if (e.port === inIf.name) {
      this.emit({ type: 'switch', device: dev.name, inPort: inIf.name, outPorts: [], mode: 'filtered', reason: 'same-port' });
      return;
    }
    const out = dev.ifaces.find((i) => i.name === e.port);
    this.emit({ type: 'switch', device: dev.name, inPort: inIf.name, outPorts: [e.port], mode: 'unicast', reason: 'known' });
    if (out) this.transmit(out, frame);
  }

  /** Current MAC table (aged), sorted by MAC. */
  macTableOf(dev: Device): MacEntry[] {
    this.ageMacTable(dev);
    return [...dev.macTable.values()].sort((a, b) => a.mac.localeCompare(b.mac));
  }

  clearMacTable(dev: Device): void {
    dev.macTable.clear();
  }

  // ---------- ARP ----------

  private arpTimeout(dev: Device): number {
    return dev.kind === 'router' ? this.opts.routerArpTimeoutMs : this.opts.hostArpTimeoutMs;
  }

  private ageArp(dev: Device): void {
    const now = this.now();
    for (const [ip, e] of [...dev.arp]) {
      if (now - e.updatedAt >= this.arpTimeout(dev)) {
        dev.arp.delete(ip);
        this.emit({ type: 'arp-cache', device: dev.name, ip, mac: e.mac, action: 'expire' });
      }
    }
  }

  /** ARP cache (aged), ordered by IP. */
  arpTableOf(dev: Device): ArpEntry[] {
    this.ageArp(dev);
    return [...dev.arp.values()].sort((a, b) => (parseIp(a.ip) ?? 0) - (parseIp(b.ip) ?? 0));
  }

  clearArp(dev: Device): void {
    dev.arp.clear();
  }

  private arpLearn(dev: Device, iface: Iface, ip: string, mac: string): void {
    const old = dev.arp.get(ip);
    dev.arp.set(ip, { ip, mac, iface: iface.name, updatedAt: this.now() });
    if (!old) this.emit({ type: 'arp-cache', device: dev.name, ip, mac, action: 'add' });
    else if (old.mac !== mac) this.emit({ type: 'arp-cache', device: dev.name, ip, mac, action: 'update' });
  }

  private sendArp(iface: Iface, p: ArpPacket, dstMac: string): void {
    this.emit({ type: 'arp', device: iface.device.name, iface: iface.name, op: p.op, senderIp: p.senderIp, senderMac: p.senderMac, targetIp: p.targetIp, targetMac: p.targetMac });
    this.transmit(iface, { id: ++this.frameSeq, srcMac: iface.mac, dstMac, etherType: 'arp', arp: p });
  }

  private arpReceive(dev: Device, iface: Iface, p: ArpPacket): void {
    const forMe = iface.ip !== undefined && p.targetIp === iface.ip;
    if (dev.arp.has(p.senderIp) || forMe) this.arpLearn(dev, iface, p.senderIp, p.senderMac);
    if (p.op === 'request') {
      if (forMe) {
        this.sendArp(iface, { op: 'reply', senderMac: iface.mac, senderIp: iface.ip as string, targetMac: p.senderMac, targetIp: p.senderIp }, p.senderMac);
      } else if (dev.kind === 'router' && iface.proxyArp && iface.ip && iface.mask && !sameSubnet(p.targetIp, iface.ip, iface.mask)) {
        const r = this.lookupRoute(dev, p.targetIp);
        if (r && r.iface !== iface) {
          this.arpLearn(dev, iface, p.senderIp, p.senderMac);
          this.sendArp(iface, { op: 'reply', senderMac: iface.mac, senderIp: p.targetIp, targetMac: p.senderMac, targetIp: p.senderIp }, p.senderMac);
        }
      }
      return;
    }
    if (forMe) this.flushPending(dev, iface, p.senderIp);
  }

  private flushPending(dev: Device, iface: Iface, ip: string): void {
    const idx = this.pending.findIndex((p) => p.device === dev && p.iface === iface && p.nextHop === ip);
    if (idx < 0) return;
    const [entry] = this.pending.splice(idx, 1) as [Pending];
    for (const { pkt, origin } of entry.packets) {
      if (this.routerDiscards(dev, pkt, origin)) {
        this.emit({ type: 'drop', device: dev.name, iface: iface.name, reason: 'arp-pending-discard' });
        continue;
      }
      this.sendIp(dev, pkt, origin);
    }
  }

  private routerDiscards(dev: Device, pkt: IpPacket, origin: 'local' | 'forward'): boolean {
    return dev.kind === 'router' && !this.opts.routerQueuesDuringArp && (origin === 'forward' || pkt.icmp.type === 'echo-request');
  }

  /** Unanswered ARP requests give up. Returns true when something was expired (new frames may be in flight). */
  private expirePending(): boolean {
    if (this.pending.length === 0) return false;
    const list = this.pending;
    this.pending = [];
    for (const p of list) {
      this.emit({ type: 'arp-timeout', device: p.device.name, ip: p.nextHop });
      for (const { pkt, origin } of p.packets) {
        this.emit({ type: 'drop', device: p.device.name, iface: p.iface.name, reason: 'arp-failed' });
        if (origin === 'local') {
          if (p.device.kind === 'host' && pkt.icmp.type === 'echo-request') {
            this.inbox.set(this.key(p.device.name, pkt.icmp.id, pkt.icmp.seq), { kind: 'host-unreachable', from: p.iface.ip, t: this.now() });
          }
        } else {
          this.sendIcmpError(p.device, pkt, 'dest-unreachable', 'host');
        }
      }
    }
    return true;
  }

  // ---------- routing ----------

  /** Routing table of a device: connected networks, static routes, host default gateway. */
  routesOf(dev: Device): { network: string; mask: string; nextHop?: string; iface?: Iface; source: 'connected' | 'static' }[] {
    const out: { network: string; mask: string; nextHop?: string; iface?: Iface; source: 'connected' | 'static' }[] = [];
    for (const i of dev.ifaces) {
      if (i.ip && i.mask && this.isUp(i)) out.push({ network: networkOf(i.ip, i.mask), mask: i.mask, iface: i, source: 'connected' });
    }
    const statics: Route[] = [...dev.routes];
    if (dev.gateway) statics.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: dev.gateway });
    for (const r of statics) out.push({ network: r.network, mask: r.mask, nextHop: r.nextHop, source: 'static' });
    return out;
  }

  /** Longest-prefix match. Connected beats static on equal length. Static routes whose next hop is not on a live connected subnet are ignored. */
  lookupRoute(dev: Device, dst: string): ResolvedRoute | null {
    let best: ResolvedRoute | null = null;
    const consider = (r: ResolvedRoute): void => {
      if (!best || r.prefix > best.prefix) best = r;
    };
    for (const r of this.routesOf(dev)) {
      const prefix = maskToPrefix(r.mask);
      if (prefix === null || !sameSubnet(dst, r.network, r.mask)) continue;
      if (r.source === 'connected' && r.iface) {
        consider({ iface: r.iface, nextHop: dst, prefix, source: 'connected' });
      } else if (r.nextHop) {
        const via = dev.ifaces.find((i) => i.ip && i.mask && this.isUp(i) && sameSubnet(i.ip, r.nextHop as string, i.mask));
        if (via) consider({ iface: via, nextHop: r.nextHop, prefix, source: 'static' });
      }
    }
    return best;
  }

  // ---------- IP ----------

  private newPacket(src: string, dst: string, ttl: number, icmp: IcmpMessage): IpPacket {
    return { id: ++this.packetSeq, src, dst, ttl, proto: 'icmp', icmp };
  }

  private sendIp(dev: Device, pkt: IpPacket, origin: 'local' | 'forward'): 'sent' | 'pending' | 'no-route' {
    const r = this.lookupRoute(dev, pkt.dst);
    if (!r) return 'no-route';
    if (!pkt.src) pkt.src = r.iface.ip as string;
    this.ageArp(dev);
    const hit = dev.arp.get(r.nextHop);
    if (hit) {
      const frame: Frame = { id: ++this.frameSeq, srcMac: r.iface.mac, dstMac: hit.mac, etherType: 'ipv4', ip: pkt };
      this.transmit(r.iface, frame);
      return 'sent';
    }
    let p = this.pending.find((x) => x.device === dev && x.iface === r.iface && x.nextHop === r.nextHop);
    if (!p) {
      p = { device: dev, iface: r.iface, nextHop: r.nextHop, packets: [] };
      this.pending.push(p);
      this.sendArp(r.iface, { op: 'request', senderMac: r.iface.mac, senderIp: r.iface.ip as string, targetMac: '00:00:00:00:00:00', targetIp: r.nextHop }, BROADCAST_MAC);
    }
    p.packets.push({ pkt, origin });
    return 'pending';
  }

  private ownIp(dev: Device, ip: string): Iface | undefined {
    return dev.ifaces.find((i) => i.ip === ip);
  }

  private ipReceive(dev: Device, iface: Iface, frame: Frame): void {
    const pkt = frame.ip as IpPacket;
    const mine = this.ownIp(dev, pkt.dst);
    if (mine) return this.deliverLocal(dev, pkt);
    if (dev.kind !== 'router') return this.drop(dev, 'not-my-ip', frame, iface);
    if (pkt.ttl <= 1) {
      this.drop(dev, 'ttl-expired', frame, iface);
      this.sendIcmpError(dev, pkt, 'time-exceeded');
      return;
    }
    const r = this.lookupRoute(dev, pkt.dst);
    if (!r) {
      this.drop(dev, 'no-route', frame, iface);
      this.sendIcmpError(dev, pkt, 'dest-unreachable', 'net');
      return;
    }
    const fwd: IpPacket = { ...pkt, ttl: pkt.ttl - 1 };
    this.emit({ type: 'ip-forward', device: dev.name, inIface: iface.name, outIface: r.iface.name, src: pkt.src, dst: pkt.dst, ttlBefore: pkt.ttl, ttlAfter: fwd.ttl, nextHop: r.nextHop });
    this.sendIp(dev, fwd, 'forward');
  }

  private sendIcmpError(dev: Device, orig: IpPacket, type: 'time-exceeded' | 'dest-unreachable', code?: 'net' | 'host'): void {
    if (orig.icmp.type !== 'echo-request' && orig.icmp.type !== 'echo-reply') return; // never answer errors with errors
    const msg: IcmpMessage = { type, code, id: orig.icmp.id, seq: orig.icmp.seq };
    const pkt = this.newPacket('', orig.src, dev.ttl, msg);
    const res = this.sendIp(dev, pkt, 'local');
    if (res !== 'no-route') {
      this.emit({ type: 'icmp', device: dev.name, kind: type, action: 'sent', src: pkt.src, dst: pkt.dst, seq: orig.icmp.seq, code });
    }
  }

  private key(dev: string, id: number, seq: number): string {
    return `${dev}|${id}|${seq}`;
  }

  private deliverLocal(dev: Device, pkt: IpPacket): void {
    const m = pkt.icmp;
    this.emit({ type: 'icmp', device: dev.name, kind: m.type, action: 'received', src: pkt.src, dst: pkt.dst, seq: m.seq, code: m.code });
    if (m.type === 'echo-request') {
      const reply = this.newPacket(pkt.dst, pkt.src, dev.ttl, { type: 'echo-reply', id: m.id, seq: m.seq });
      if (this.ownIp(dev, pkt.src)) return this.deliverLocal(dev, reply);
      if (this.sendIp(dev, reply, 'local') !== 'no-route') {
        this.emit({ type: 'icmp', device: dev.name, kind: 'echo-reply', action: 'sent', src: reply.src, dst: reply.dst, seq: m.seq });
      }
      return;
    }
    const kind: PingKind =
      m.type === 'echo-reply' ? 'reply' : m.type === 'time-exceeded' ? 'ttl-expired' : m.code === 'net' ? 'net-unreachable' : 'host-unreachable';
    this.inbox.set(this.key(dev.name, m.id, m.seq), { kind, from: pkt.src, ttl: pkt.ttl, t: this.now() });
  }

  // ---------- ping / traceroute ----------

  /** Put one echo request on the wire without running the network (use step or run, then echoResult). */
  startEcho(devName: string, dst: string, o: { ttl?: number; id?: number; seq?: number } = {}): EchoHandle {
    const dev = this.device(devName);
    const id = o.id ?? this.rng.int(1, 65535);
    const seq = o.seq ?? 1;
    const h: EchoHandle = { device: devName, dst, id, seq, t0: this.now() };
    this.inbox.delete(this.key(devName, id, seq));
    const pkt = this.newPacket('', dst, o.ttl ?? dev.ttl, { type: 'echo-request', id, seq });
    if (this.ownIp(dev, dst)) {
      pkt.src = dst;
      this.emit({ type: 'icmp', device: dev.name, kind: 'echo-request', action: 'sent', src: pkt.src, dst, seq });
      this.deliverLocal(dev, pkt);
      return h;
    }
    const r = this.lookupRoute(dev, dst);
    if (!r) {
      const from = dev.ifaces.find((i) => i.ip)?.ip;
      this.inbox.set(this.key(devName, id, seq), { kind: 'no-route', from, t: h.t0 });
      return h;
    }
    this.emit({ type: 'icmp', device: dev.name, kind: 'echo-request', action: 'sent', src: r.iface.ip as string, dst, seq });
    this.sendIp(dev, pkt, 'local');
    return h;
  }

  /** Outcome of an echo started with startEcho, or undefined while still unanswered. */
  echoResult(h: EchoHandle): PingReply | undefined {
    const o = this.inbox.get(this.key(h.device, h.id, h.seq));
    if (!o) return undefined;
    const rtt = Math.max(0, o.t - h.t0) + this.rng.next() * 0.3;
    return { seq: h.seq, kind: o.kind, from: o.from, ttl: o.kind === 'reply' ? o.ttl : undefined, rttMs: o.kind === 'no-route' ? undefined : rtt };
  }

  /** Send one echo request and run the network to quiescence. */
  private probe(devName: string, dst: string, ttl: number | undefined, id: number, seq: number, timeoutMs: number): PingReply {
    const h = this.startEcho(devName, dst, { ttl, id, seq });
    this.run();
    let reply = this.echoResult(h);
    this.inbox.delete(this.key(devName, id, seq));
    if (!reply) {
      this.tick(timeoutMs);
      reply = { seq, kind: 'timeout' };
    }
    this.emit({ type: 'probe-result', device: devName, dst, seq, kind: reply.kind, from: reply.from });
    return reply;
  }

  /** ICMP echo from `from` to `dst`. Default 4 echoes, 1 s apart, 32-byte payload. */
  ping(from: string, dst: string, o: { count?: number; ttl?: number; timeoutMs?: number; size?: number } = {}): PingResult {
    const count = o.count ?? 4;
    const timeout = o.timeoutMs ?? 4000;
    const id = this.rng.int(1, 65535);
    const replies: PingReply[] = [];
    for (let seq = 1; seq <= count; seq++) {
      if (seq > 1) this.tick(1000);
      replies.push(this.probe(from, dst, o.ttl, id, seq, timeout));
    }
    const ok = replies.filter((r) => r.kind === 'reply');
    const rtts = ok.map((r) => r.rttMs ?? 0);
    const res: PingResult = {
      target: dst,
      size: o.size ?? 32,
      replies,
      sent: count,
      received: ok.length,
      lossPct: count === 0 ? 0 : Math.round(((count - ok.length) / count) * 100),
    };
    if (rtts.length > 0) {
      res.rttMin = Math.min(...rtts);
      res.rttMax = Math.max(...rtts);
      res.rttAvg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    }
    return res;
  }

  /** ICMP traceroute: probes with TTL 1.. until the target answers, an unreachable error arrives, or `maxHops`. */
  traceroute(from: string, dst: string, o: { maxHops?: number; probes?: number; timeoutMs?: number } = {}): TraceResult {
    const maxHops = o.maxHops ?? 30;
    const probes = o.probes ?? 3;
    const id = this.rng.int(1, 65535);
    const hops: TraceHop[] = [];
    let reached = false;
    let seq = 0;
    for (let ttl = 1; ttl <= maxHops; ttl++) {
      const hop: TraceHop = { ttl, probes: [] };
      for (let p = 0; p < probes; p++) {
        const r = this.probe(from, dst, ttl, id, ++seq, o.timeoutMs ?? 4000);
        hop.probes.push({ kind: r.kind, from: r.from, rttMs: r.rttMs });
        hop.addr ??= r.from;
      }
      hops.push(hop);
      const kinds = hop.probes.map((p) => p.kind);
      if (kinds.includes('reply')) {
        reached = true;
        break;
      }
      if (kinds.some((k) => k === 'host-unreachable' || k === 'net-unreachable' || k === 'no-route')) break;
    }
    return { target: dst, hops, reached };
  }
}

export { shortIfName, ipToString };
