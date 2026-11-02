import { describe, expect, it } from 'vitest';
import { createRng } from '@tikshuv/core';
import { labTwoHosts, labTwoRouters, labTwoSubnets } from './labs.js';
import { Network } from './network.js';
import type { SimEvent, TopologySpec } from './types.js';

const types = (net: Network, t: SimEvent['type']): SimEvent[] => net.trace.filter((e) => e.type === t);
const mac = (net: Network, dev: string, i = 0): string => (net.device(dev).ifaces[i] as { mac: string }).mac;

describe('topology construction', () => {
  it('builds devices, assigns deterministic unique MACs and links', () => {
    const net = new Network(labTwoHosts);
    expect(net.devices.map((d) => d.name)).toEqual(['PC1', 'PC2', 'PC3', 'SW1']);
    const macs = net.devices.flatMap((d) => d.ifaces.map((i) => i.mac));
    expect(new Set(macs).size).toBe(macs.length);
    expect(mac(net, 'PC1')).toBe('00:1a:2b:00:00:01');
    expect(net.iface('SW1', 'fa0/1').peer?.device.name).toBe('PC1');
    expect(net.device('SW1').ifaces).toHaveLength(26);
  });

  it('rejects bad topologies', () => {
    const base = { devices: [{ name: 'A', kind: 'host' as const }, { name: 'B', kind: 'host' as const }], links: [] };
    expect(() => new Network({ ...base, links: [['A', 'Z']] })).toThrow(/unknown device/);
    expect(() => new Network({ ...base, links: [['A', 'B:Gi9/9']] })).toThrow(/unknown interface/);
    expect(() => new Network({ ...base, devices: [...base.devices, { name: 'A', kind: 'host' }] })).toThrow(/duplicate/);
    expect(() => new Network({ devices: [{ name: 'R', kind: 'router' }, { name: 'A', kind: 'host' }], links: [['R', 'A']] })).toThrow(/several interfaces/);
    expect(() => new Network({ devices: [{ name: 'A', kind: 'host', ip: '1.1.1.1', mask: '255.0.255.0' }], links: [] })).toThrow(/bad address/);
    expect(() => new Network({ ...base, links: [['A', 'B'], ['A', 'B']] })).toThrow(/already linked/);
  });

  it('routers start shut down, hosts and switch ports start up', () => {
    const net = new Network({ devices: [{ name: 'R', kind: 'router' }, { name: 'S', kind: 'switch' }, { name: 'H', kind: 'host' }], links: [] });
    expect(net.iface('R', 'g0/0').adminUp).toBe(false);
    expect(net.iface('S', 'fa0/1').adminUp).toBe(true);
    expect(net.iface('H', 'Ethernet0').adminUp).toBe(true);
  });
});

describe('two hosts on one switch (U1, U2, U5)', () => {
  it('first ping is ARP then ICMP, the switch learns both MACs', () => {
    const net = new Network(labTwoHosts);
    const sw = net.device('SW1');
    expect(net.macTableOf(sw)).toHaveLength(0);
    const r = net.ping('PC1', '192.168.1.20', { count: 1 });
    expect(r.replies[0]?.kind).toBe('reply');
    expect(r.replies[0]?.ttl).toBe(128);

    const arp = types(net, 'arp');
    expect(arp.map((e) => (e as { op: string }).op)).toEqual(['request', 'reply']);
    const firstIcmp = net.trace.findIndex((e) => e.type === 'icmp');
    const firstArpTx = net.trace.findIndex((e) => e.type === 'tx' && e.frame.etherType === 'arp');
    const firstIpTx = net.trace.findIndex((e) => e.type === 'tx' && e.frame.etherType === 'ipv4');
    expect(firstArpTx).toBeLessThan(firstIpTx);
    expect(firstIcmp).toBeLessThan(firstArpTx);

    const table = net.macTableOf(sw);
    expect(table.map((e) => [e.mac, e.port])).toEqual([
      [mac(net, 'PC1'), 'FastEthernet0/1'],
      [mac(net, 'PC2'), 'FastEthernet0/2'],
    ]);
  });

  it('ARP request is a broadcast flooded to every other live port, the reply is unicast', () => {
    const net = new Network(labTwoHosts);
    net.ping('PC1', '192.168.1.20', { count: 1 });
    const sw = types(net, 'switch') as Extract<SimEvent, { type: 'switch' }>[];
    expect(sw[0]).toMatchObject({ mode: 'flood', reason: 'broadcast', inPort: 'FastEthernet0/1', outPorts: ['FastEthernet0/2', 'FastEthernet0/3'] });
    expect(sw[1]).toMatchObject({ mode: 'unicast', reason: 'known', outPorts: ['FastEthernet0/1'] });
    // PC3 saw the broadcast but has no reason to answer (not its IP) and does not cache anything.
    expect(net.device('PC3').arp.size).toBe(0);
  });

  it('both ends cache each other (target learns the requester)', () => {
    const net = new Network(labTwoHosts);
    net.ping('PC1', '192.168.1.20', { count: 1 });
    expect(net.arpTableOf(net.device('PC1')).map((e) => [e.ip, e.mac])).toEqual([['192.168.1.20', mac(net, 'PC2')]]);
    expect(net.arpTableOf(net.device('PC2')).map((e) => [e.ip, e.mac])).toEqual([['192.168.1.10', mac(net, 'PC1')]]);
  });

  it('the second ping needs no ARP', () => {
    const net = new Network(labTwoHosts);
    net.ping('PC1', '192.168.1.20', { count: 1 });
    net.clearTrace();
    const r = net.ping('PC1', '192.168.1.20', { count: 1 });
    expect(r.received).toBe(1);
    expect(types(net, 'arp')).toHaveLength(0);
  });

  it('a four-ping run has no loss and rtt stats', () => {
    const net = new Network(labTwoHosts);
    const r = net.ping('PC1', '192.168.1.20');
    expect(r).toMatchObject({ sent: 4, received: 4, lossPct: 0 });
    expect(r.rttMin).toBeLessThanOrEqual(r.rttAvg as number);
    expect(r.rttAvg).toBeLessThanOrEqual(r.rttMax as number);
  });

  it('unknown unicast is flooded and other hosts discard it by MAC', () => {
    const net = new Network(labTwoHosts);
    net.ping('PC1', '192.168.1.20', { count: 1 });
    net.clearMacTable(net.device('SW1'));
    net.clearTrace();
    net.ping('PC1', '192.168.1.20', { count: 1 });
    const sw = types(net, 'switch') as Extract<SimEvent, { type: 'switch' }>[];
    expect(sw[0]).toMatchObject({ mode: 'flood', reason: 'unknown-unicast' });
    const drops = types(net, 'drop') as Extract<SimEvent, { type: 'drop' }>[];
    expect(drops.some((d) => d.device === 'PC3' && d.reason === 'dst-mac-mismatch')).toBe(true);
    // the reply taught the switch where PC2 is again
    expect(net.macTableOf(net.device('SW1'))).toHaveLength(2);
  });

  it('MAC entries age out after 300 s and emit mac-expire', () => {
    const net = new Network(labTwoHosts);
    net.ping('PC1', '192.168.1.20', { count: 1 });
    net.tick(299_000);
    expect(net.macTableOf(net.device('SW1'))).toHaveLength(2);
    net.tick(2_000);
    expect(net.macTableOf(net.device('SW1'))).toHaveLength(0);
    expect(types(net, 'mac-expire')).toHaveLength(2);
  });

  it('ARP cache entries expire (host timeout)', () => {
    const net = new Network(labTwoHosts, { hostArpTimeoutMs: 10_000 });
    net.ping('PC1', '192.168.1.20', { count: 1 });
    net.tick(11_000);
    expect(net.arpTableOf(net.device('PC1'))).toHaveLength(0);
    expect(types(net, 'arp-cache').some((e) => (e as { action: string }).action === 'expire')).toBe(true);
  });

  it('pinging a dead address on the LAN gives host unreachable from the sender (Windows behaviour)', () => {
    const net = new Network(labTwoHosts);
    const r = net.ping('PC1', '192.168.1.99', { count: 2 });
    expect(r.replies.map((x) => x.kind)).toEqual(['host-unreachable', 'host-unreachable']);
    expect(r.replies[0]?.from).toBe('192.168.1.10');
    expect(types(net, 'arp-timeout').length).toBeGreaterThanOrEqual(1);
  });

  it('pinging yourself answers locally', () => {
    const net = new Network(labTwoHosts);
    const r = net.ping('PC1', '192.168.1.10', { count: 1 });
    expect(r.replies[0]?.kind).toBe('reply');
    expect(types(net, 'tx')).toHaveLength(0);
  });

  it('an unplugged host has no route', () => {
    const net = new Network({ devices: [{ name: 'A', kind: 'host', ip: '10.0.0.1', mask: '255.255.255.0' }], links: [] });
    expect(net.ping('A', '10.0.0.2', { count: 1 }).replies[0]).toMatchObject({ kind: 'no-route' });
  });

  it('an administratively down port cuts the link', () => {
    const net = new Network(labTwoHosts);
    net.setAdmin(net.iface('SW1', 'fa0/2'), false);
    expect(net.ping('PC1', '192.168.1.20', { count: 1 }).replies[0]?.kind).toBe('host-unreachable');
  });
});

describe('wrong configuration (U3, U4)', () => {
  it('wrong mask on the destination: ARP works but the reply cannot get back, so ping times out', () => {
    const spec: TopologySpec = {
      devices: [
        { name: 'PC1', kind: 'host', ip: '192.168.1.10', mask: '255.255.255.0' },
        { name: 'PC2', kind: 'host', ip: '192.168.1.20', mask: '255.255.255.240' },
        { name: 'SW1', kind: 'switch' },
      ],
      links: [['PC1', 'SW1:Fa0/1'], ['PC2', 'SW1:Fa0/2']],
    };
    const net = new Network(spec);
    const r = net.ping('PC1', '192.168.1.20', { count: 2 });
    expect(r.replies.map((x) => x.kind)).toEqual(['timeout', 'timeout']);
    expect(net.arpTableOf(net.device('PC1'))).toHaveLength(1); // ARP itself succeeded
  });

  it('wrong mask on the sender: destination looks off-link and there is no gateway', () => {
    const net = new Network(labTwoHosts);
    net.device('PC1').ifaces[0]!.mask = '255.255.255.240';
    const r = net.ping('PC1', '192.168.1.20', { count: 1 });
    expect(r.replies[0]).toMatchObject({ kind: 'no-route', from: '192.168.1.10' });
  });

  it('wrong gateway (nobody there): host unreachable from the sender', () => {
    const net = new Network(labTwoSubnets);
    net.device('PC1').gateway = '192.168.1.254';
    const r = net.ping('PC1', '192.168.2.10', { count: 1 });
    expect(r.replies[0]).toMatchObject({ kind: 'host-unreachable', from: '192.168.1.10' });
  });

  it('gateway outside the host subnet is ignored: no route', () => {
    const net = new Network(labTwoSubnets);
    net.device('PC1').gateway = '10.9.9.9';
    expect(net.ping('PC1', '192.168.2.10', { count: 1 }).replies[0]?.kind).toBe('no-route');
  });

  it('missing gateway keeps the host inside its own subnet', () => {
    const net = new Network(labTwoSubnets);
    net.device('PC1').gateway = undefined;
    expect(net.ping('PC1', '192.168.2.10', { count: 1 }).replies[0]?.kind).toBe('no-route');
    expect(net.ping('PC1', '192.168.1.1', { count: 1 }).replies[0]?.kind).toBe('reply');
  });

  it('an interface left shut down (router default) breaks the path', () => {
    const net = new Network(labTwoSubnets);
    net.setAdmin(net.iface('R1', 'g0/1'), false);
    const r = net.ping('PC1', '192.168.2.10', { count: 2 });
    expect(r.replies.every((x) => x.kind === 'net-unreachable')).toBe(true);
    expect(r.replies[0]?.from).toBe('192.168.1.1');
  });
});

describe('cross-subnet via the default gateway', () => {
  it('first ping loses one echo (router ARPs and discards it), the rest succeed with TTL 127', () => {
    const net = new Network(labTwoSubnets);
    const r = net.ping('PC1', '192.168.2.10');
    expect(r.replies.map((x) => x.kind)).toEqual(['timeout', 'reply', 'reply', 'reply']);
    expect(r.replies[1]?.ttl).toBe(127);
    const fwd = types(net, 'ip-forward') as Extract<SimEvent, { type: 'ip-forward' }>[];
    expect(fwd[0]).toMatchObject({ device: 'R1', inIface: 'GigabitEthernet0/0', outIface: 'GigabitEthernet0/1', ttlBefore: 128, ttlAfter: 127 });
  });

  it('the host ARPs for the gateway, never for the remote host; frames change MACs at the router', () => {
    const net = new Network(labTwoSubnets);
    net.ping('PC1', '192.168.2.10', { count: 2 });
    const pc1 = net.arpTableOf(net.device('PC1'));
    expect(pc1.map((e) => e.ip)).toEqual(['192.168.1.1']);
    const txs = types(net, 'tx') as Extract<SimEvent, { type: 'tx' }>[];
    const echoOnLan1 = txs.find((e) => e.from.device === 'PC1' && e.frame.etherType === 'ipv4');
    const echoOnLan2 = txs.find((e) => e.from.device === 'R1' && e.frame.etherType === 'ipv4' && e.frame.dstIp === '192.168.2.10');
    expect(echoOnLan1?.frame.dstMac).toBe(mac(net, 'R1', 0));
    expect(echoOnLan1?.frame.dstIp).toBe('192.168.2.10');
    expect(echoOnLan2?.frame.srcMac).toBe(mac(net, 'R1', 1));
    expect(echoOnLan2?.frame.dstMac).toBe(mac(net, 'PC2'));
    expect(echoOnLan1?.frame.packetId).toBeDefined();
  });

  it('routers can be configured to hold the packet during ARP', () => {
    const net = new Network(labTwoSubnets, { routerQueuesDuringArp: true });
    const r = net.ping('PC1', '192.168.2.10', { count: 2 });
    expect(r.replies.map((x) => x.kind)).toEqual(['reply', 'reply']);
  });

  it('unknown destination network: router answers net unreachable', () => {
    const net = new Network(labTwoSubnets);
    const r = net.ping('PC1', '172.16.0.1', { count: 1 });
    expect(r.replies[0]).toMatchObject({ kind: 'net-unreachable', from: '192.168.1.1' });
  });

  it('nonexistent host on a routed subnet: router answers host unreachable after its ARP fails', () => {
    const net = new Network(labTwoSubnets);
    const r = net.ping('PC1', '192.168.2.99', { count: 1 });
    expect(r.replies[0]).toMatchObject({ kind: 'host-unreachable', from: '192.168.1.1' });
  });
});

describe('proxy ARP', () => {
  const spec = (proxy: boolean): TopologySpec => ({
    devices: [
      { name: 'PC1', kind: 'host', ip: '192.168.1.10', mask: '255.255.0.0' }, // too-wide mask, no gateway
      { name: 'PC2', kind: 'host', ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
      { name: 'SW1', kind: 'switch' },
      { name: 'SW2', kind: 'switch' },
      {
        name: 'R1',
        kind: 'router',
        interfaces: [
          { name: 'GigabitEthernet0/0', ip: '192.168.1.1', mask: '255.255.255.0', up: true, proxyArp: proxy },
          { name: 'GigabitEthernet0/1', ip: '192.168.2.1', mask: '255.255.255.0', up: true },
        ],
      },
    ],
    links: [['PC1', 'SW1:Fa0/1'], ['R1:Gi0/0', 'SW1:Fa0/2'], ['R1:Gi0/1', 'SW2:Fa0/2'], ['PC2', 'SW2:Fa0/1']],
  });

  it('is off by default: nobody answers the ARP for an off-link address', () => {
    const net = new Network(spec(false));
    expect(net.ping('PC1', '192.168.2.10', { count: 1 }).replies[0]?.kind).toBe('host-unreachable');
  });

  it('when enabled the router answers with its own MAC and forwards', () => {
    const net = new Network(spec(true));
    const r = net.ping('PC1', '192.168.2.10', { count: 2 });
    expect(r.replies.map((x) => x.kind)).toEqual(['timeout', 'reply']);
    const e = net.device('PC1').arp.get('192.168.2.10');
    expect(e?.mac).toBe(mac(net, 'R1', 0));
  });
});

describe('TTL, traceroute and loops (U6)', () => {
  it('TTL 1 expires at the first router, reported from its ingress address', () => {
    const net = new Network(labTwoRouters);
    const r = net.ping('PC1', '10.0.2.10', { count: 1, ttl: 1 });
    expect(r.replies[0]).toMatchObject({ kind: 'ttl-expired', from: '10.0.1.1' });
    const exp = (types(net, 'drop') as Extract<SimEvent, { type: 'drop' }>[]).find((d) => d.reason === 'ttl-expired');
    expect(exp?.device).toBe('R1');
  });

  it('TTL 2 expires at the second router', () => {
    const net = new Network(labTwoRouters);
    const r = net.ping('PC1', '10.0.2.10', { count: 2, ttl: 2 });
    expect(r.replies[1]).toMatchObject({ kind: 'ttl-expired', from: '10.0.12.2' });
  });

  it('traceroute lists each router then the destination', () => {
    const net = new Network(labTwoRouters);
    const t = net.traceroute('PC1', '10.0.2.10');
    expect(t.reached).toBe(true);
    expect(t.hops.map((h) => h.addr)).toEqual(['10.0.1.1', '10.0.12.2', '10.0.2.10']);
    expect(t.hops[0]?.probes.every((p) => p.kind === 'ttl-expired')).toBe(true);
    expect(t.hops[2]?.probes.some((p) => p.kind === 'reply')).toBe(true);
  });

  it('traceroute stops at an unreachable network', () => {
    const net = new Network(labTwoRouters);
    const t = net.traceroute('PC1', '172.16.0.1');
    expect(t.reached).toBe(false);
    expect(t.hops).toHaveLength(2); // hop 1 TTL expires at R1, hop 2 R1 has no route
    expect(t.hops[1]?.probes[0]).toMatchObject({ kind: 'net-unreachable', from: '10.0.1.1' });
  });

  it('traceroute against a silent target runs to max hops of timeouts', () => {
    const net = new Network(labTwoRouters);
    const t = net.traceroute('PC1', '10.0.2.99', { maxHops: 5, probes: 1 });
    expect(t.hops.length).toBeGreaterThanOrEqual(3);
    expect(t.hops.at(-1)?.probes[0]?.kind).not.toBe('reply');
  });

  it('a routing loop ends by TTL expiry, not by hanging', () => {
    const net = new Network({
      ...labTwoRouters,
      devices: labTwoRouters.devices.map((d) =>
        d.name === 'R1' ? { ...d, routes: [{ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.0.12.2' }] } : d.name === 'R2' ? { ...d, routes: [{ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.0.12.1' }] } : d,
      ),
    });
    const r = net.ping('PC1', '9.9.9.9', { count: 2 });
    expect(r.replies[1]?.kind).toBe('ttl-expired');
    expect(types(net, 'ip-forward').length).toBeGreaterThan(100);
  });

  it('longest prefix wins over a default route', () => {
    const net = new Network(labTwoRouters);
    const r1 = net.device('R1');
    r1.routes.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.0.12.2' });
    expect(net.lookupRoute(r1, '10.0.2.10')?.prefix).toBe(24);
    expect(net.lookupRoute(r1, '8.8.8.8')?.prefix).toBe(0);
    expect(net.lookupRoute(r1, '10.0.1.55')?.source).toBe('connected');
  });
});

describe('determinism, stepping, clock', () => {
  it('same seed gives identical traces and results', () => {
    const run = (): string => {
      const net = new Network(labTwoSubnets, { rng: createRng(7) });
      const r = net.ping('PC1', '192.168.2.10');
      return JSON.stringify([r, net.trace]);
    };
    expect(run()).toBe(run());
  });

  it('events are strictly ordered by seq and time never goes backwards', () => {
    const net = new Network(labTwoSubnets);
    net.ping('PC1', '192.168.2.10');
    net.trace.forEach((e, i) => {
      expect(e.seq).toBe(i + 1);
      if (i > 0) expect(e.t).toBeGreaterThanOrEqual((net.trace[i - 1] as SimEvent).t);
    });
  });

  it('step() delivers one frame at a time so an animation can drive it', () => {
    const net = new Network(labTwoHosts);
    const h = net.startEcho('PC1', '192.168.1.20');
    expect(net.inFlight).toBe(1); // the ARP request
    expect(net.echoResult(h)).toBeUndefined();
    let steps = 0;
    while (net.step()) steps++;
    expect(steps).toBeGreaterThanOrEqual(5);
    expect(net.step()).toBe(false);
    expect(net.echoResult(h)?.kind).toBe('reply');
  });

  it('listeners receive events as they are emitted and can unsubscribe', () => {
    const net = new Network(labTwoHosts);
    const seen: string[] = [];
    const off = net.onEvent((e) => seen.push(e.type));
    net.ping('PC1', '192.168.1.20', { count: 1 });
    const n = seen.length;
    expect(n).toBeGreaterThan(5);
    off();
    net.ping('PC1', '192.168.1.20', { count: 1 });
    expect(seen).toHaveLength(n);
  });

  it('an injected clock drives timestamps and aging', () => {
    let now = 1000;
    const net = new Network(labTwoHosts, { clock: () => now });
    net.ping('PC1', '192.168.1.20', { count: 1 });
    expect(net.trace.every((e) => e.t >= 1000)).toBe(true);
    now += 400_000;
    expect(net.macTableOf(net.device('SW1'))).toHaveLength(0);
  });

  it('the step limit guards against runaway loops', () => {
    const net = new Network(labTwoHosts, { maxSteps: 3 });
    expect(() => net.ping('PC1', '192.168.1.20', { count: 1 })).toThrow(/step limit/);
  });
});
