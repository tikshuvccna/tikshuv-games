# Networking facts to confirm with the teacher (from net-sim defaults)

1. Router interfaces start shut down.
2. A router drops the packet that triggered its ARP request, so the first ping across a router times out (`.!!!!`). Toggle: `routerQueuesDuringArp`.
3. Timers: MAC age 300 s, host ARP 120 s, router ARP 4 h.
4. Windows counts "unreachable" and "TTL expired" replies as Received.
5. Proxy ARP off by default (real Cisco default is on).
6. Both `show mac address-table` and `show mac-address-table` accepted.
7. Class A boundary 1-126.
8. `show ip route` is a simplified format.
9. Ping with no route prints `.` on IOS.
10. Windows `arp -a` omits broadcast/multicast rows.
11. Global commands (e.g. `hostname`) typed in config-if drop back to config mode.
12. Traceroute probes are ICMP; first probe of a hop can show `*` because of ARP.
