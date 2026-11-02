import type { TopologySpec } from './types.js';

/** Ready-made topologies for lessons, tests and the later SVG stage. All addresses and links are plain data. */

/** PC1 and PC2 on one switch, one /24 subnet. Unit U1/U2/U5. */
export const labTwoHosts: TopologySpec = {
  devices: [
    { name: 'PC1', kind: 'host', ip: '192.168.1.10', mask: '255.255.255.0' },
    { name: 'PC2', kind: 'host', ip: '192.168.1.20', mask: '255.255.255.0' },
    { name: 'PC3', kind: 'host', ip: '192.168.1.30', mask: '255.255.255.0' },
    { name: 'SW1', kind: 'switch' },
  ],
  links: [
    ['PC1', 'SW1:Fa0/1'],
    ['PC2', 'SW1:Fa0/2'],
    ['PC3', 'SW1:Fa0/3'],
  ],
};

/** Two /24 subnets joined by R1 (gateways .1). Unit U3/U4. */
export const labTwoSubnets: TopologySpec = {
  devices: [
    { name: 'PC1', kind: 'host', ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' },
    { name: 'PC2', kind: 'host', ip: '192.168.2.10', mask: '255.255.255.0', gateway: '192.168.2.1' },
    { name: 'SW1', kind: 'switch' },
    { name: 'SW2', kind: 'switch' },
    {
      name: 'R1',
      kind: 'router',
      interfaces: [
        { name: 'GigabitEthernet0/0', ip: '192.168.1.1', mask: '255.255.255.0', up: true },
        { name: 'GigabitEthernet0/1', ip: '192.168.2.1', mask: '255.255.255.0', up: true },
      ],
    },
  ],
  links: [
    ['PC1', 'SW1:Fa0/1'],
    ['R1:Gi0/0', 'SW1:Fa0/24'],
    ['R1:Gi0/1', 'SW2:Fa0/24'],
    ['PC2', 'SW2:Fa0/1'],
  ],
};

/** PC1 - R1 - R2 - PC2 with static routes; for TTL, traceroute and loops. Unit U6. */
export const labTwoRouters: TopologySpec = {
  devices: [
    { name: 'PC1', kind: 'host', ip: '10.0.1.10', mask: '255.255.255.0', gateway: '10.0.1.1' },
    { name: 'PC2', kind: 'host', ip: '10.0.2.10', mask: '255.255.255.0', gateway: '10.0.2.1' },
    {
      name: 'R1',
      kind: 'router',
      interfaces: [
        { name: 'GigabitEthernet0/0', ip: '10.0.1.1', mask: '255.255.255.0', up: true },
        { name: 'GigabitEthernet0/1', ip: '10.0.12.1', mask: '255.255.255.252', up: true },
      ],
      routes: [{ network: '10.0.2.0', mask: '255.255.255.0', nextHop: '10.0.12.2' }],
    },
    {
      name: 'R2',
      kind: 'router',
      interfaces: [
        { name: 'GigabitEthernet0/0', ip: '10.0.12.2', mask: '255.255.255.252', up: true },
        { name: 'GigabitEthernet0/1', ip: '10.0.2.1', mask: '255.255.255.0', up: true },
      ],
      routes: [{ network: '10.0.1.0', mask: '255.255.255.0', nextHop: '10.0.12.1' }],
    },
  ],
  links: [
    ['PC1', 'R1:Gi0/0'],
    ['R1:Gi0/1', 'R2:Gi0/0'],
    ['R2:Gi0/1', 'PC2'],
  ],
};
