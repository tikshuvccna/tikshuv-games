import { describe, expect, it } from 'vitest';
import {
  broadcastOf,
  firstHost,
  formatMac,
  hostCount,
  ipClass,
  ipToString,
  isApipa,
  isHostAddress,
  isValidMask,
  lastHost,
  makeMac,
  maskToPrefix,
  networkOf,
  normalizeMac,
  parseCidr,
  parseIp,
  prefixToMask,
  sameSubnet,
} from './addr.js';

describe('ipv4 helpers', () => {
  it('parses and prints dotted quads', () => {
    expect(parseIp('192.168.1.10')).toBe(3232235786);
    expect(ipToString(3232235786)).toBe('192.168.1.10');
    expect(ipToString(0xffffffff)).toBe('255.255.255.255');
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['1.2.3', '1.2.3.256', '1.2.3.4.5', 'a.b.c.d', '01.2.3.4', '']) expect(parseIp(bad)).toBeNull();
  });

  it('converts masks and prefixes both ways', () => {
    expect(prefixToMask(24)).toBe('255.255.255.0');
    expect(prefixToMask(0)).toBe('0.0.0.0');
    expect(prefixToMask(30)).toBe('255.255.255.252');
    expect(maskToPrefix('255.255.240.0')).toBe(20);
    expect(maskToPrefix('255.0.255.0')).toBeNull();
    expect(isValidMask('255.255.255.256')).toBe(false);
  });

  it('computes network, broadcast and host range', () => {
    expect(networkOf('192.168.1.77', '255.255.255.192')).toBe('192.168.1.64');
    expect(broadcastOf('192.168.1.77', '255.255.255.192')).toBe('192.168.1.127');
    expect(firstHost('192.168.1.77', '255.255.255.192')).toBe('192.168.1.65');
    expect(lastHost('192.168.1.77', '255.255.255.192')).toBe('192.168.1.126');
    expect(hostCount('255.255.255.192')).toBe(62);
    expect(hostCount('255.255.255.252')).toBe(2);
    expect(hostCount('255.255.255.255')).toBe(1);
  });

  it('throws on bad input to network/broadcast', () => {
    expect(() => networkOf('x', '255.255.255.0')).toThrow();
    expect(() => broadcastOf('1.1.1.1', 'bad')).toThrow();
  });

  it('decides same subnet by mask (wrong mask changes the answer)', () => {
    expect(sameSubnet('192.168.1.10', '192.168.1.20', '255.255.255.0')).toBe(true);
    expect(sameSubnet('192.168.1.10', '192.168.1.20', '255.255.255.240')).toBe(false);
  });

  it('flags network and broadcast addresses as unusable for hosts', () => {
    expect(isHostAddress('192.168.1.0', '255.255.255.0')).toBe(false);
    expect(isHostAddress('192.168.1.255', '255.255.255.0')).toBe(false);
    expect(isHostAddress('192.168.1.1', '255.255.255.0')).toBe(true);
    expect(isHostAddress('10.0.0.1', '255.255.255.252')).toBe(true);
  });

  it('parses CIDR notation', () => {
    expect(parseCidr('10.1.2.3/16')).toEqual({ network: '10.1.0.0', mask: '255.255.0.0', prefix: 16 });
    expect(parseCidr('10.1.2.3/33')).toBeNull();
    expect(parseCidr('10.1.2.3')).toBeNull();
  });

  it('classifies classful ranges and APIPA', () => {
    expect(ipClass('10.0.0.1')).toBe('A');
    expect(ipClass('172.16.0.1')).toBe('B');
    expect(ipClass('192.168.0.1')).toBe('C');
    expect(ipClass('224.0.0.5')).toBe('D');
    expect(ipClass('250.0.0.1')).toBe('E');
    expect(ipClass('nope')).toBeNull();
    expect(isApipa('169.254.3.4')).toBe(true);
    expect(isApipa('192.168.0.1')).toBe(false);
  });
});

describe('mac helpers', () => {
  it('normalises the three common notations', () => {
    expect(normalizeMac('00-1A-2B-3C-4D-5E')).toBe('00:1a:2b:3c:4d:5e');
    expect(normalizeMac('001a.2b3c.4d5e')).toBe('00:1a:2b:3c:4d:5e');
    expect(normalizeMac('00:1a:2b:3c:4d:5e')).toBe('00:1a:2b:3c:4d:5e');
    expect(normalizeMac('00:1a:2b')).toBeNull();
    expect(normalizeMac('zz:1a:2b:3c:4d:5e')).toBeNull();
  });

  it('formats Windows and Cisco styles', () => {
    expect(formatMac('00:1a:2b:3c:4d:5e', 'windows')).toBe('00-1A-2B-3C-4D-5E');
    expect(formatMac('00:1a:2b:3c:4d:5e', 'cisco')).toBe('001a.2b3c.4d5e');
    expect(formatMac('00:1a:2b:3c:4d:5e')).toBe('00:1a:2b:3c:4d:5e');
  });

  it('builds deterministic MACs', () => {
    expect(makeMac('00:1a:2b', 1)).toBe('00:1a:2b:00:00:01');
    expect(makeMac('00:1a:2b', 0x010203)).toBe('00:1a:2b:01:02:03');
  });
});
