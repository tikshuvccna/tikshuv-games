import type { SimTrace, TopologyLayout } from './types';

/** Demo: PC-A pings PC-B through a switch; ARP first, then ICMP echo request/reply. */
export const DEMO_LAYOUT: TopologyLayout = {
  nodes: [
    { id: 'pcA', kind: 'host', x: 80, y: 140, label: 'PC-A' },
    { id: 'sw1', kind: 'switch', x: 260, y: 140, label: 'SW1' },
    { id: 'pcB', kind: 'host', x: 440, y: 140, label: 'PC-B' },
  ],
  links: [
    { a: 'pcA', b: 'sw1' },
    { a: 'sw1', b: 'pcB' },
  ],
};

const A = { mac: 'AA:AA:AA:AA:AA:AA', ip: '10.0.0.1' };
const B = { mac: 'BB:BB:BB:BB:BB:BB', ip: '10.0.0.2' };
const BCAST = 'FF:FF:FF:FF:FF:FF';

export const DEMO_TRACE: SimTrace = [
  { t: 0, kind: 'arp-request', from: 'pcA', to: 'sw1', label: 'ARP who-has 10.0.0.2', fields: { srcMac: A.mac, dstMac: BCAST, srcIp: A.ip, dstIp: B.ip } },
  { t: 1, kind: 'table-update', from: 'sw1', to: 'sw1', label: `${A.mac}  port 1`, fields: { srcMac: A.mac } },
  { t: 2, kind: 'arp-request', from: 'sw1', to: 'pcB', label: 'ARP who-has 10.0.0.2', fields: { srcMac: A.mac, dstMac: BCAST, srcIp: A.ip, dstIp: B.ip } },
  { t: 3, kind: 'arp-reply', from: 'pcB', to: 'sw1', label: 'ARP is-at BB:BB', fields: { srcMac: B.mac, dstMac: A.mac, srcIp: B.ip, dstIp: A.ip } },
  { t: 4, kind: 'table-update', from: 'sw1', to: 'sw1', label: `${B.mac}  port 2`, fields: { srcMac: B.mac } },
  { t: 5, kind: 'arp-reply', from: 'sw1', to: 'pcA', label: 'ARP is-at BB:BB', fields: { srcMac: B.mac, dstMac: A.mac, srcIp: B.ip, dstIp: A.ip } },
  { t: 6, kind: 'icmp', from: 'pcA', to: 'sw1', label: 'ICMP echo request', fields: { srcMac: A.mac, dstMac: B.mac, srcIp: A.ip, dstIp: B.ip, ttl: 64 } },
  { t: 7, kind: 'icmp', from: 'sw1', to: 'pcB', label: 'ICMP echo request', fields: { srcMac: A.mac, dstMac: B.mac, srcIp: A.ip, dstIp: B.ip, ttl: 64 } },
  { t: 8, kind: 'icmp', from: 'pcB', to: 'sw1', label: 'ICMP echo reply', fields: { srcMac: B.mac, dstMac: A.mac, srcIp: B.ip, dstIp: A.ip, ttl: 64 } },
  { t: 9, kind: 'icmp', from: 'sw1', to: 'pcA', label: 'ICMP echo reply', fields: { srcMac: B.mac, dstMac: A.mac, srcIp: B.ip, dstIp: A.ip, ttl: 64 } },
];

/** Hebrew captions, one per DEMO_TRACE step (callers own the text; content, not UI chrome). */
export const DEMO_CAPTIONS_HE: readonly string[] = [
  'PC-A רוצה לשלוח ל-10.0.0.2 אבל לא מכיר את הכתובת הפיזית שלו. הוא שולח שאלת ARP לכולם (שידור).',
  'המתג לומד: הכתובת של PC-A נמצאת ביציאה 1. נוספה שורה בטבלת הכתובות.',
  'המתג לא יודע איפה PC-B, אז הוא מעביר את השאלה הלאה.',
  'PC-B עונה ישירות ל-PC-A: הכתובת הפיזית שלי היא BB:BB:BB:BB:BB:BB.',
  'המתג לומד גם את PC-B: יציאה 2. עכשיו שתי השורות בטבלה.',
  'התשובה מגיעה ל-PC-A. הוא שומר אותה ויכול לשלוח.',
  'PC-A שולח פינג (ICMP) אל PC-B. הפעם הכתובת הפיזית ידועה.',
  'המתג מכיר את היעד בטבלה ומעביר רק ליציאה 2.',
  'PC-B עונה לפינג.',
  'התשובה חוזרת ל-PC-A. הפינג הצליח.',
];

export const DEMO = { layout: DEMO_LAYOUT, trace: DEMO_TRACE, captions: DEMO_CAPTIONS_HE } as const;
