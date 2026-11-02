/**
 * Input types of the sim stage. Defined here (not imported from net-sim) on purpose:
 * net-sim adapts its own output to these shapes.
 */
export type SimNodeId = string;

export type SimEventKind = 'frame' | 'packet' | 'arp-request' | 'arp-reply' | 'icmp' | 'drop' | 'table-update';

export interface SimHeaderFields {
  srcMac?: string;
  dstMac?: string;
  srcIp?: string;
  dstIp?: string;
  ttl?: number;
}

export interface SimEvent {
  /** Logical time, only used for ordering and display. Playback pacing comes from durations. */
  t: number;
  kind: SimEventKind;
  /** Node the packet leaves. For 'drop' the node where it dies; for 'table-update' the node whose table changes. */
  from: SimNodeId;
  /** Node the packet reaches. For 'table-update' it may equal `from`. */
  to: SimNodeId;
  /** Short label shown on the packet, e.g. "ARP who-has 10.0.0.2". For table-update: the table row text. */
  label: string;
  fields: SimHeaderFields;
  note?: string;
}

export type SimTrace = readonly SimEvent[];

export type SimNodeKind = 'host' | 'switch' | 'router';

export interface SimLayoutNode {
  id: SimNodeId;
  kind: SimNodeKind;
  x: number;
  y: number;
  label: string;
}

export interface SimLayoutLink {
  a: SimNodeId;
  b: SimNodeId;
}

export interface TopologyLayout {
  nodes: readonly SimLayoutNode[];
  links: readonly SimLayoutLink[];
}
