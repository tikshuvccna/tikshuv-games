import { describe, expect, it } from 'vitest';
import { labTwoHosts, labTwoRouters, labTwoSubnets } from './labs.js';
import { IosCli } from './ios.js';
import { Network } from './network.js';
import { WindowsCli, winTraceOutput } from './windows.js';
import type { TopologySpec } from './types.js';

/** R1 starts blank (interfaces shut down) with a PC on Gi0/0 and a second router on Gi0/1. */
const blankRouter: TopologySpec = {
  devices: [
    { name: 'PC1', kind: 'host', ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
    { name: 'R1', kind: 'router', hostname: 'R1' },
    { name: 'SW1', kind: 'switch', hostname: 'SW1' },
  ],
  links: [['PC1', 'R1:Gi0/0'], ['R1:Gi0/1', 'SW1:Fa0/24']],
};

const run = (cli: IosCli, ...lines: string[]): string[][] => lines.map((l) => cli.exec(l).output);

describe('IOS modes and prompts', () => {
  it('walks user > privileged > config > config-if and back', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    expect(cli.prompt()).toBe('R1>');
    cli.exec('enable');
    expect(cli.prompt()).toBe('R1#');
    cli.exec('configure terminal');
    expect(cli.mode).toBe('config');
    expect(cli.prompt()).toBe('R1(config)#');
    cli.exec('interface gigabitEthernet 0/0');
    expect(cli.prompt()).toBe('R1(config-if)#');
    cli.exec('exit');
    expect(cli.mode).toBe('config');
    cli.exec('int g0/1');
    cli.exec('end');
    expect(cli.mode).toBe('priv');
    cli.exec('disable');
    expect(cli.mode).toBe('user');
  });

  it('accepts abbreviations', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    cli.exec('en');
    expect(cli.exec('conf t').mode).toBe('config');
    expect(cli.exec('int gi0/0').mode).toBe('config-if');
    expect(cli.exec('ip add 192.168.1.1 255.255.255.0').error).toBeUndefined();
  });

  it('hostname changes the prompt', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    cli.exec('enable');
    cli.exec('conf t');
    expect(cli.exec('hostname Gateway').prompt).toBe('Gateway(config)#');
    expect(cli.exec('exit').prompt).toBe('Gateway#');
  });

  it('exit at the top level closes the session', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    expect(cli.exec('exit').closed).toBe(true);
    expect(cli.exec('enable').closed).toBeFalsy();
  });

  it('blank lines do nothing and hosts are rejected', () => {
    const net = new Network(blankRouter);
    expect(new IosCli(net, 'R1').exec('   ').output).toEqual([]);
    expect(() => new IosCli(net, 'PC1')).toThrow();
  });
});

describe('IOS errors are data', () => {
  it('invalid input points the caret under the bad word, prompt included', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    const r = cli.exec('show foo');
    expect(r.error).toMatchObject({ kind: 'invalid', column: 5 });
    expect(r.output).toEqual([`${' '.repeat(3 + 5)}^`, "% Invalid input detected at '^' marker."]);
  });

  it('incomplete command', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    expect(cli.exec('show ip').output).toEqual(['% Incomplete command.']);
    cli.exec('enable');
    cli.exec('conf t');
    expect(cli.exec('interface').error?.kind).toBe('incomplete');
  });

  it('ambiguous abbreviation', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    const r = cli.exec('e');
    expect(r.error?.kind).toBe('ambiguous');
    expect(r.output).toEqual(['% Ambiguous command:  "e"']);
  });

  it('privileged commands are invalid in user mode', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    expect(cli.exec('show running-config').error?.kind).toBe('invalid');
    expect(cli.exec('configure terminal').error?.kind).toBe('invalid');
  });

  it('extra words after a complete command are invalid', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    expect(cli.exec('enable now').error).toMatchObject({ kind: 'invalid', column: 7 });
  });

  it('bad address and bad mask are rejected at the right token', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    cli.exec('en');
    cli.exec('conf t');
    cli.exec('int g0/0');
    expect(cli.exec('ip address 300.1.1.1 255.255.255.0').error).toMatchObject({ kind: 'invalid', column: 11 });
    expect(cli.exec('ip address 10.0.0.1 255.0.255.0').error).toMatchObject({ kind: 'invalid', column: 20 });
    expect(cli.exec('ip address 192.168.1.0 255.255.255.0').output).toEqual(['Bad mask /24 for address 192.168.1.0']);
  });

  it('unknown interface is invalid input', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    cli.exec('en');
    cli.exec('conf t');
    expect(cli.exec('interface gi 9/9').error?.kind).toBe('invalid');
  });

  it('overlapping subnets are refused', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    cli.exec('en');
    cli.exec('conf t');
    cli.exec('int g0/0');
    cli.exec('ip address 192.168.1.1 255.255.255.0');
    cli.exec('int g0/1');
    expect(cli.exec('ip address 192.168.1.2 255.255.255.0').output).toEqual(['% 192.168.1.0 overlaps with GigabitEthernet0/0']);
  });
});

describe('IOS help and completion', () => {
  it('? lists the next options with descriptions', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    const h = cli.exec('show ?').output;
    expect(h.some((l) => /^ {2}arp\s+ARP table$/.test(l))).toBe(true);
    expect(h.some((l) => l.includes('ip'))).toBe(true);
    expect(cli.exec('?').output.some((l) => l.includes('enable'))).toBe(true);
  });

  it('shows <cr> where a command may end and argument placeholders', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    expect(cli.exec('show ip interface brief ?').output[0]).toMatch(/<cr>/);
    expect(cli.exec('ping ?').output[0]).toContain('A.B.C.D');
  });

  it('word? lists commands starting with it', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    expect(cli.exec('e?').output).toEqual(['enable  exit']);
    expect(cli.exec('zz?').output).toEqual(['% Unrecognized command']);
    expect(cli.exec('show zz ?').output[0]).toContain('Invalid input');
  });

  it('help inside config mode honours do', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    cli.exec('en');
    cli.exec('conf t');
    expect(cli.help('do show ').some((l) => l.includes('running-config'))).toBe(true);
  });

  it('tab completes unique prefixes and reports ambiguity', () => {
    const cli = new IosCli(new Network(blankRouter), 'R1');
    cli.exec('en');
    expect(cli.complete('conf').line).toBe('configure ');
    expect(cli.complete('configure t').line).toBe('configure terminal ');
    const amb = cli.complete('c');
    expect(amb.candidates.sort()).toEqual(['clear', 'configure', 'copy']);
    expect(amb.line).toBe('c');
    expect(cli.complete('cl').line).toBe('clear ');
    expect(cli.complete('zzz').candidates).toEqual([]);
    expect(cli.complete('show ').line).toBe('show ');
  });
});

describe('router configuration and show commands', () => {
  const configured = (): { net: Network; cli: IosCli } => {
    const net = new Network(blankRouter);
    const cli = new IosCli(net, 'R1');
    run(cli, 'enable', 'configure terminal', 'interface gigabitEthernet 0/0', 'ip address 192.168.1.1 255.255.255.0');
    return { net, cli };
  };

  it('no shutdown brings the link up and logs like IOS', () => {
    const { cli } = configured();
    const out = cli.exec('no shutdown').output;
    expect(out).toEqual([
      '%LINK-5-CHANGED: Interface GigabitEthernet0/0, changed state to up',
      '%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up',
    ]);
    expect(cli.exec('no shutdown').output).toEqual([]); // already up
    expect(cli.exec('shutdown').output[0]).toContain('administratively down');
  });

  it('show ip interface brief has the Cisco column layout', () => {
    const { cli } = configured();
    cli.exec('no shutdown');
    cli.exec('end');
    const out = cli.exec('sh ip int br').output;
    expect(out).toEqual([
      'Interface              IP-Address      OK? Method Status                Protocol',
      'GigabitEthernet0/0     192.168.1.1     YES manual up                    up',
      'GigabitEthernet0/1     unassigned      YES unset  administratively down down',
    ]);
  });

  it('a configured but unplugged or peer-down interface is down/down', () => {
    const { cli } = configured();
    cli.exec('end');
    expect(cli.exec('show ip interface brief').output[1]).toMatch(/192\.168\.1\.1 +YES manual administratively down +down$/);
    cli.exec('conf t');
    cli.exec('int g0/0');
    cli.exec('no shutdown');
    cli.exec('end');
    cli.exec('conf t');
    cli.exec('int g0/1');
    cli.exec('no shutdown');
    cli.exec('end');
    expect(cli.exec('show ip interface brief').output[2]).toMatch(/GigabitEthernet0\/1 +unassigned +YES unset +up +up$/);
  });

  it('show running-config reflects the configuration', () => {
    const { cli } = configured();
    cli.exec('description to PC1');
    cli.exec('no shutdown');
    expect(cli.exec('hostname Edge').mode).toBe('config'); // global command from config-if drops back
    cli.exec('end');
    const out = cli.exec('show running-config').output;
    expect(out[0]).toBe('Building configuration...');
    expect(out.join('\n')).toMatch(/hostname Edge/);
    expect(out).toContain('interface GigabitEthernet0/0');
    expect(out).toContain(' description to PC1');
    expect(out).toContain(' ip address 192.168.1.1 255.255.255.0');
    expect(out).toContain('interface GigabitEthernet0/1');
    expect(out.at(-1)).toBe('end');
    // g0/1 is still shut, g0/0 is not
    const g1 = out.indexOf('interface GigabitEthernet0/1');
    expect(out.slice(g1, g1 + 6)).toContain(' shutdown');
  });

  it('copy run start saves; show startup-config prints it', () => {
    const { cli } = configured();
    cli.exec('end');
    expect(cli.exec('show startup-config').output).toEqual(['startup-config is not present']);
    expect(cli.exec('copy running-config startup-config').output).toEqual(['Building configuration...', '[OK]']);
    expect(cli.exec('write memory').output).toContain('[OK]');
    expect(cli.exec('show startup-config').output.join('\n')).toContain('ip address 192.168.1.1 255.255.255.0');
  });

  it('static routes and default route show up in show ip route', () => {
    const { cli } = configured();
    cli.exec('no shutdown');
    cli.exec('exit');
    cli.exec('ip route 10.5.0.0 255.255.0.0 192.168.1.2');
    cli.exec('ip route 0.0.0.0 0.0.0.0 192.168.1.2');
    cli.exec('end');
    const out = cli.exec('show ip route').output;
    expect(out).toContain('Gateway of last resort is 192.168.1.2 to network 0.0.0.0');
    expect(out).toContain('C    192.168.1.0/24 is directly connected, GigabitEthernet0/0');
    expect(out).toContain('S    10.5.0.0/16 [1/0] via 192.168.1.2');
    expect(out.some((l) => l.startsWith('S*'))).toBe(true);
    cli.exec('conf t');
    cli.exec('no ip route 10.5.0.0 255.255.0.0 192.168.1.2');
    cli.exec('end');
    expect(cli.exec('show ip route').output.join('\n')).not.toContain('10.5.0.0');
  });

  it('ip proxy-arp and no ip proxy-arp toggle the interface flag and the config text', () => {
    const { net, cli } = configured();
    cli.exec('ip proxy-arp');
    expect(net.iface('R1', 'g0/0').proxyArp).toBe(true);
    cli.exec('end');
    expect(cli.exec('show run').output).toContain(' ip proxy-arp');
    cli.exec('conf t');
    cli.exec('int g0/0');
    cli.exec('no ip proxy-arp');
    expect(net.iface('R1', 'g0/0').proxyArp).toBe(false);
    cli.exec('no ip address');
    expect(net.iface('R1', 'g0/0').ip).toBeUndefined();
  });

  it('do runs exec commands from config mode', () => {
    const { cli } = configured();
    const r = cli.exec('do show ip interface brief');
    expect(r.output[0]).toContain('Interface');
    expect(r.mode).toBe('config-if');
    expect(cli.exec('do show foo').error?.column).toBe(8);
  });

  it('router ping: first echo lost to ARP, then four bangs', () => {
    const { cli } = configured();
    cli.exec('no shutdown');
    cli.exec('end');
    const out = cli.exec('ping 192.168.1.10').output;
    expect(out[0]).toBe('Type escape sequence to abort.');
    expect(out[1]).toBe('Sending 5, 100-byte ICMP Echos to 192.168.1.10, timeout is 2 seconds:');
    expect(out[2]).toBe('.!!!!');
    expect(out[3]).toMatch(/^Success rate is 80 percent \(4\/5\), round-trip min\/avg\/max = \d+\/\d+\/\d+ ms$/);
  });

  it('router ping to a dead address: all dots, 0 percent, no rtt line', () => {
    const { cli } = configured();
    cli.exec('no shutdown');
    cli.exec('end');
    const out = cli.exec('ping 192.168.1.77').output;
    expect(out[2]).toBe('.....');
    expect(out[3]).toBe('Success rate is 0 percent (0/5)');
  });

  it('show arp lists own interface with "-" age and learned neighbours', () => {
    const { cli } = configured();
    cli.exec('no shutdown');
    cli.exec('end');
    cli.exec('ping 192.168.1.10');
    const out = cli.exec('show ip arp').output;
    expect(out[0]).toBe('Protocol  Address          Age (min)  Hardware Addr   Type   Interface');
    expect(out[1]).toMatch(/^Internet {2}192\.168\.1\.1 +- {3}[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4} {2}ARPA {3}GigabitEthernet0\/0$/);
    expect(out[2]).toMatch(/^Internet {2}192\.168\.1\.10 +0 /);
    expect(cli.exec('show arp').output).toEqual(out);
    cli.exec('clear arp-cache');
    expect(cli.exec('show arp').output).toHaveLength(2);
  });

  it('traceroute output has numbered hops', () => {
    const net = new Network(labTwoRouters);
    const cli = new IosCli(net, 'R1');
    const out = cli.exec('traceroute 10.0.2.10').output;
    expect(out[1]).toBe('Tracing the route to 10.0.2.10');
    expect(out.some((l) => /^ {2}1 10\.0\.12\.2 /.test(l))).toBe(true);
    expect(net.device('R1').hostname).toBe('R1');
  });

  it('ping to self-owned unreachable network from a router prints dots, not an exception', () => {
    const { cli } = configured();
    cli.exec('end');
    expect(cli.exec('ping 172.16.0.1').output[2]).toBe('.....');
  });
});

describe('switch CLI (U2, U7-U10)', () => {
  const lab = (): { net: Network; sw: IosCli } => {
    const net = new Network(labTwoHosts);
    return { net, sw: new IosCli(net, 'SW1') };
  };

  it('show mac address-table matches the Cisco layout after a ping', () => {
    const { net, sw } = lab();
    sw.exec('enable');
    expect(sw.exec('show mac address-table').output).toHaveLength(6); // headers + total, no rows yet
    net.ping('PC1', '192.168.1.20', { count: 1 });
    const out = sw.exec('sh mac address-table').output;
    expect(out.slice(0, 5)).toEqual(['          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----']);
    expect(out[5]).toBe('   1    001a.2b00.0001    DYNAMIC     Fa0/1');
    expect(out[6]).toBe('   1    001a.2b00.0002    DYNAMIC     Fa0/2');
    expect(out[7]).toBe('Total Mac Addresses for this criterion: 2');
  });

  it('accepts both spellings of the command (mac-address-table and mac address-table)', () => {
    const { net, sw } = lab();
    net.ping('PC1', '192.168.1.20', { count: 1 });
    expect(sw.exec('show mac-address-table').output).toEqual(sw.exec('show mac address-table').output);
  });

  it('clear mac address-table dynamic empties it', () => {
    const { net, sw } = lab();
    net.ping('PC1', '192.168.1.20', { count: 1 });
    sw.exec('enable');
    sw.exec('clear mac address-table dynamic');
    expect(net.macTableOf(net.device('SW1'))).toHaveLength(0);
  });

  it('router-only commands are invalid on a switch and vice versa', () => {
    const { sw } = lab();
    expect(sw.exec('show ip route').error?.kind).toBe('invalid');
    sw.exec('en');
    sw.exec('conf t');
    sw.exec('int fa0/1');
    expect(sw.exec('ip address 1.1.1.1 255.255.255.0').error?.kind).toBe('invalid'); // L2 port
    expect(sw.exec('shutdown').error).toBeUndefined();
    expect(sw.exec('speed 100').error).toBeUndefined();
    expect(sw.exec('duplex full').error).toBeUndefined();
    const net = new Network(blankRouter);
    expect(new IosCli(net, 'R1').exec('show mac address-table').error?.kind).toBe('invalid');
  });

  it('shutting a port stops traffic and show ip int br tells the story', () => {
    const { net, sw } = lab();
    sw.exec('en');
    sw.exec('conf t');
    sw.exec('interface fa0/2');
    expect(sw.exec('shutdown').output[0]).toBe('%LINK-5-CHANGED: Interface FastEthernet0/2, changed state to administratively down');
    sw.exec('end');
    const brief = sw.exec('show ip interface brief').output;
    expect(brief.find((l) => l.startsWith('FastEthernet0/2 '))).toMatch(/administratively down +down$/);
    expect(brief.find((l) => l.startsWith('FastEthernet0/1 '))).toMatch(/unassigned +YES unset +up +up$/);
    expect(brief.find((l) => l.startsWith('FastEthernet0/5 '))).toMatch(/unset +down +down$/);
    expect(brief.at(-1)).toMatch(/^Vlan1 /);
    expect(net.ping('PC1', '192.168.1.20', { count: 1 }).replies[0]?.kind).toBe('host-unreachable');
  });

  it('show arp is empty on a switch without an IP', () => {
    const { sw } = lab();
    expect(sw.exec('show arp').output).toEqual([]);
  });

  it('running-config of a switch lists its ports and Vlan1', () => {
    const { sw } = lab();
    sw.exec('en');
    const out = sw.exec('show running-config').output;
    expect(out).toContain('interface FastEthernet0/24');
    expect(out).toContain('interface Vlan1');
    sw.exec('conf t');
    expect(sw.exec('ip default-gateway 192.168.1.1').error).toBeUndefined();
  });
});

describe('Windows host CLI', () => {
  const win = (spec = labTwoSubnets, host = 'PC1'): { net: Network; cli: WindowsCli } => {
    const net = new Network(spec);
    return { net, cli: new WindowsCli(net, host) };
  };

  it('ipconfig shows address, mask and gateway', () => {
    const { cli } = win();
    const out = cli.exec('ipconfig').output;
    expect(out).toContain('Ethernet adapter Ethernet:');
    expect(out).toContain('   IPv4 Address. . . . . . . . . . . : 192.168.1.10');
    expect(out).toContain('   Subnet Mask . . . . . . . . . . . : 255.255.255.0');
    expect(out).toContain('   Default Gateway . . . . . . . . . : 192.168.1.1');
  });

  it('ipconfig /all adds the physical address in Windows format', () => {
    const { cli } = win();
    const out = cli.exec('ipconfig /all').output;
    expect(out).toContain('   Physical Address. . . . . . . . . : 00-1A-2B-00-00-01');
    expect(out.some((l) => l.includes('Host Name'))).toBe(true);
  });

  it('ipconfig on an unplugged adapter says media disconnected', () => {
    const net = new Network({ devices: [{ name: 'PC9', kind: 'host' }], links: [] });
    expect(new WindowsCli(net, 'PC9').exec('ipconfig').output.join('\n')).toContain('Media disconnected');
  });

  it('ping prints Windows-style replies and statistics', () => {
    const { cli } = win(labTwoHosts);
    const out = cli.exec('ping 192.168.1.20').output;
    expect(out[1]).toBe('Pinging 192.168.1.20 with 32 bytes of data:');
    expect(out[2]).toMatch(/^Reply from 192\.168\.1\.20: bytes=32 time<1ms TTL=128$/);
    expect(out).toContain('Ping statistics for 192.168.1.20:');
    expect(out).toContain('    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),');
    expect(out.at(-1)).toMatch(/^ {4}Minimum = 0ms, Maximum = 0ms, Average = 0ms$/);
  });

  it('first ping across the router times out, the rest reply with TTL 127', () => {
    const { cli } = win();
    const out = cli.exec('ping 192.168.2.10').output;
    expect(out[2]).toBe('Request timed out.');
    expect(out[3]).toBe('Reply from 192.168.2.10: bytes=32 time<1ms TTL=127');
    expect(out).toContain('    Packets: Sent = 4, Received = 3, Lost = 1 (25% loss),');
  });

  it('timeouts only: no round trip block', () => {
    const { cli } = win(labTwoHosts);
    // 192.168.1.30 exists; use a TTL-less dead path instead: unreachable counts as received in Windows
    const out = cli.exec('ping -n 2 192.168.1.99').output;
    expect(out[2]).toBe('Reply from 192.168.1.10: Destination host unreachable.');
    expect(out).toContain('    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),');
    const none = cli.exec('ping -n 1 -i 1 192.168.1.20').output; // TTL 1 on the same LAN still arrives
    expect(none[2]).toContain('Reply from 192.168.1.20');
  });

  it('TTL expired and net unreachable messages', () => {
    const { cli } = win(labTwoRouters, 'PC1');
    expect(cli.exec('ping -n 1 -i 1 10.0.2.10').output[2]).toBe('Reply from 10.0.1.1: TTL expired in transit.');
    expect(cli.exec('ping -n 1 172.16.0.1').output[2]).toBe('Reply from 10.0.1.1: Destination net unreachable.');
  });

  it('ping with a total loss shows 100% loss and no times', () => {
    const spec: TopologySpec = {
      devices: [
        { name: 'PC1', kind: 'host', ip: '192.168.1.10', mask: '255.255.255.0' },
        { name: 'PC2', kind: 'host', ip: '192.168.1.20', mask: '255.255.255.240' },
        { name: 'SW1', kind: 'switch' },
      ],
      links: [['PC1', 'SW1:Fa0/1'], ['PC2', 'SW1:Fa0/2']],
    };
    const out = win(spec).cli.exec('ping -n 2 192.168.1.20').output;
    expect(out).toContain('    Packets: Sent = 2, Received = 0, Lost = 2 (100% loss),');
    expect(out.some((l) => l.includes('Minimum'))).toBe(false);
  });

  it('ping argument errors', () => {
    const { cli } = win();
    expect(cli.exec('ping').output[1]).toContain('Usage: ping');
    expect(cli.exec('ping server').output[1]).toBe('Ping request could not find host server. Please check the name and try again.');
  });

  it('arp -a lists learned neighbours in Windows format; -d clears', () => {
    const { cli } = win(labTwoHosts);
    expect(cli.exec('arp -a').output).toEqual(['', 'No ARP Entries Found.']);
    cli.exec('ping -n 1 192.168.1.20');
    const out = cli.exec('arp -a').output;
    expect(out[1]).toBe('Interface: 192.168.1.10 --- 0x4');
    expect(out[2]).toBe('  Internet Address      Physical Address      Type');
    expect(out[3]).toBe('  192.168.1.20          00-1A-2B-00-00-02     dynamic');
    cli.exec('arp -d');
    expect(cli.exec('arp -a').output).toEqual(['', 'No ARP Entries Found.']);
    expect(cli.exec('arp').output[0]).toBe('');
  });

  it('tracert prints hops and Trace complete', () => {
    const { cli } = win(labTwoRouters);
    const out = cli.exec('tracert 10.0.2.10').output;
    expect(out[1]).toBe('Tracing route to 10.0.2.10 over a maximum of 30 hops');
    expect(out[3]).toMatch(/^ {2}1 +<1 ms +<1 ms +<1 ms {2}10\.0\.1\.1$/);
    expect(out.some((l) => /^ {2}3 .*10\.0\.2\.10$/.test(l))).toBe(true);
    expect(out.at(-1)).toBe('Trace complete.');
  });

  it('tracert shows timeouts and unreachable reports', () => {
    const { cli } = win(labTwoRouters);
    const t1 = cli.exec('tracert -h 4 10.0.2.99').output;
    expect(t1.some((l) => l.includes('reports: Destination host unreachable.'))).toBe(true);
    const silent = winTraceOutput({ target: '1.1.1.1', reached: false, hops: [{ ttl: 1, probes: [{ kind: 'timeout' }, { kind: 'timeout' }, { kind: 'timeout' }] }] }, 30);
    expect(silent[3]).toBe('  1       *      *      *  Request timed out.');
    const t2 = cli.exec('tracert 172.16.0.1').output;
    expect(t2.some((l) => l.includes('reports: Destination net unreachable.'))).toBe(true);
    expect(cli.exec('tracert').output[1]).toContain('Usage: tracert');
    expect(cli.exec('tracert host').output[1]).toContain('Unable to resolve');
  });

  it('unknown commands use the cmd.exe message; hostname and completion work', () => {
    const { cli } = win();
    expect(cli.exec('foo').output).toEqual(["'foo' is not recognized as an internal or external command,", 'operable program or batch file.']);
    expect(cli.exec('').output).toEqual([]);
    expect(cli.exec('hostname').output).toEqual(['PC1']);
    expect(cli.prompt()).toBe('C:\\>');
    expect(cli.complete('ipc').line).toBe('ipconfig ');
    expect(cli.complete('p').line).toBe('ping ');
    expect(cli.complete('a').line).toBe('arp ');
    expect(cli.complete('zz').candidates).toEqual([]);
    expect(cli.complete('ping 1').line).toBe('ping 1');
  });

  it('refuses non-hosts', () => {
    const net = new Network(labTwoSubnets);
    expect(() => new WindowsCli(net, 'R1')).toThrow();
  });
});
