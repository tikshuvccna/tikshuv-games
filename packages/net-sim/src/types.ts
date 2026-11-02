import type { Rng } from '@tikshuv/core';

export type DeviceKind = 'host' | 'switch' | 'router';

export interface IfaceSpec {
  name: string;
  mac?: string;
  ip?: string;
  mask?: string;
  /** Administrative state. Default: up for hosts and switch ports, down (shutdown) for router interfaces, as on real Cisco gear. */
  up?: boolean;
  proxyArp?: boolean;
  description?: string;
}

export interface RouteSpec {
  network: string;
  mask: string;
  nextHop: string;
}

export interface DeviceSpec {
  name: string;
  kind: DeviceKind;
  /** IOS hostname (prompt). Defaults to `name`. */
  hostname?: string;
  /** Interface names or full specs. Defaults: host Ethernet0, router GigabitEthernet0/0 + 0/1, switch FastEthernet0/1-24 + GigabitEthernet0/1-2. */
  interfaces?: readonly (string | IfaceSpec)[];
  /** Host shortcuts, applied to the first interface. */
  ip?: string;
  mask?: string;
  gateway?: string;
  routes?: readonly RouteSpec[];
  /** Initial TTL for packets this device originates. Host 128, router/switch 255. */
  ttl?: number;
}

/** Plain-object topology. Links are `['SW1:Fa0/1', 'PC1']` (interface part optional when the device has one interface). */
export interface TopologySpec {
  devices: readonly DeviceSpec[];
  links: readonly (readonly [string, string])[];
}

export interface NetworkOptions {
  rng?: Rng;
  /** Injectable millisecond clock. Default: internal virtual clock advanced by steps and `tick`. */
  clock?: () => number;
  /** Virtual time one link hop takes (ms). Default 0.05 (a LAN ping shows time<1ms). */
  hopMs?: number;
  /** MAC table aging (ms). Cisco default 300 s [A]. */
  macAgingMs?: number;
  /** ARP cache timeout, hosts (ms). Default 120 s [A, Windows varies]. */
  hostArpTimeoutMs?: number;
  /** ARP cache timeout, routers (ms). Cisco default 4 h [A]. */
  routerArpTimeoutMs?: number;
  /** Routers hold (true) or discard (false, default) the packet that triggered ARP; discard gives the classic ".!!!!" first ping [A]. */
  routerQueuesDuringArp?: boolean;
  /** Hard cap on steps per `run`. */
  maxSteps?: number;
}

export interface Iface {
  name: string;
  device: Device;
  mac: string;
  ip?: string;
  mask?: string;
  adminUp: boolean;
  proxyArp: boolean;
  description?: string;
  peer?: Iface;
}

export interface ArpEntry {
  ip: string;
  mac: string;
  iface: string;
  updatedAt: number;
}

export interface MacEntry {
  mac: string;
  port: string;
  updatedAt: number;
}

export interface Route {
  network: string;
  mask: string;
  nextHop: string;
}

export interface Device {
  name: string;
  kind: DeviceKind;
  hostname: string;
  ifaces: Iface[];
  ttl: number;
  routes: Route[];
  gateway?: string;
  arp: Map<string, ArpEntry>;
  macTable: Map<string, MacEntry>;
}

// ---- wire model ----
export interface ArpPacket {
  op: 'request' | 'reply';
  senderMac: string;
  senderIp: string;
  targetMac: string;
  targetIp: string;
}

export type IcmpType = 'echo-request' | 'echo-reply' | 'dest-unreachable' | 'time-exceeded';

export interface IcmpMessage {
  type: IcmpType;
  code?: 'net' | 'host';
  /** For errors these are the id/seq of the packet that triggered the error. */
  id: number;
  seq: number;
}

export interface IpPacket {
  id: number;
  src: string;
  dst: string;
  ttl: number;
  proto: 'icmp';
  icmp: IcmpMessage;
}

export interface Frame {
  id: number;
  srcMac: string;
  dstMac: string;
  etherType: 'arp' | 'ipv4';
  arp?: ArpPacket;
  ip?: IpPacket;
}

/** Flattened frame description carried by events (what an animation shows on the packet). */
export interface FrameInfo {
  frameId: number;
  packetId?: number;
  srcMac: string;
  dstMac: string;
  etherType: 'arp' | 'ipv4';
  srcIp?: string;
  dstIp?: string;
  ttl?: number;
  summary: string;
}

export interface Endpoint {
  device: string;
  iface: string;
}

export type DropReason =
  | 'link-down'
  | 'dst-mac-mismatch'
  | 'not-my-ip'
  | 'ttl-expired'
  | 'no-route'
  | 'arp-pending-discard'
  | 'arp-failed'
  | 'filtered-same-port'
  | 'unsupported';

export type PingKind = 'reply' | 'host-unreachable' | 'net-unreachable' | 'ttl-expired' | 'timeout' | 'no-route';

export type SimEventBody =
  | { type: 'tx'; from: Endpoint; to: Endpoint; frame: FrameInfo }
  | { type: 'drop'; device: string; iface?: string; reason: DropReason; frame?: FrameInfo }
  | { type: 'arp'; device: string; iface: string; op: 'request' | 'reply'; senderIp: string; senderMac: string; targetIp: string; targetMac: string }
  | { type: 'arp-cache'; device: string; ip: string; mac: string; action: 'add' | 'update' | 'expire' }
  | { type: 'arp-timeout'; device: string; ip: string }
  | { type: 'mac-learn'; device: string; mac: string; port: string; action: 'add' | 'move' }
  | { type: 'mac-expire'; device: string; mac: string; port: string }
  | { type: 'switch'; device: string; inPort: string; outPorts: string[]; mode: 'flood' | 'unicast' | 'filtered'; reason: 'broadcast' | 'unknown-unicast' | 'known' | 'same-port' }
  | { type: 'ip-forward'; device: string; inIface: string; outIface: string; src: string; dst: string; ttlBefore: number; ttlAfter: number; nextHop: string }
  | { type: 'icmp'; device: string; kind: IcmpType; action: 'sent' | 'received'; src: string; dst: string; seq: number; code?: 'net' | 'host' }
  | { type: 'probe-result'; device: string; dst: string; seq: number; kind: PingKind; from?: string };

export type SimEvent = SimEventBody & { seq: number; t: number };

export interface PingReply {
  seq: number;
  kind: PingKind;
  /** Source of the reply or ICMP error. */
  from?: string;
  ttl?: number;
  rttMs?: number;
}

export interface PingResult {
  target: string;
  size: number;
  replies: PingReply[];
  sent: number;
  received: number;
  lossPct: number;
  rttMin?: number;
  rttMax?: number;
  rttAvg?: number;
}

export interface TraceProbe {
  kind: PingKind;
  from?: string;
  rttMs?: number;
}

export interface TraceHop {
  ttl: number;
  probes: TraceProbe[];
  /** First responding address, if any. */
  addr?: string;
}

export interface TraceResult {
  target: string;
  hops: TraceHop[];
  reached: boolean;
}
