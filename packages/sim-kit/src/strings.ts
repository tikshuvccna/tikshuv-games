import type { SimEventKind } from './types';

export interface SimStrings {
  play: string;
  pause: string;
  stepForward: string;
  stepBack: string;
  restart: string;
  speed: string;
  timeline: string;
  inspect: string;
  close: string;
  stage: string;
  tableTitle: string;
  stepOf(i: number, n: number): string;
  kinds: Record<SimEventKind, string>;
  fields: { srcMac: string; dstMac: string; srcIp: string; dstIp: string; ttl: string };
}

/** Default kit strings (Hebrew). Callers may pass their own (e.g. from locales). */
export const SIM_STRINGS_HE: SimStrings = {
  play: 'הפעלה',
  pause: 'השהיה',
  stepForward: 'צעד קדימה',
  stepBack: 'צעד אחורה',
  restart: 'מההתחלה',
  speed: 'מהירות',
  timeline: 'ציר זמן',
  inspect: 'בדיקת החבילה',
  close: 'סגירה',
  stage: 'הדגמת רשת',
  tableTitle: 'טבלת כתובות',
  stepOf: (i, n) => `שלב ${i} מתוך ${n}`,
  kinds: {
    frame: 'מסגרת',
    packet: 'חבילה',
    'arp-request': 'שאלת ARP',
    'arp-reply': 'תשובת ARP',
    icmp: 'פינג',
    drop: 'נפלה',
    'table-update': 'עדכון טבלה',
  },
  fields: { srcMac: 'MAC מקור', dstMac: 'MAC יעד', srcIp: 'IP מקור', dstIp: 'IP יעד', ttl: 'TTL' },
};
