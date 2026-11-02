/** Dev route #/dev: terminal-ui + net-sim lab, sim-kit stage, and save/session/audio test switches. */
import { MOOD_IDS } from '@tikshuv/audio';
import { SCENE_MOODS, type SceneMoodId } from '@tikshuv/core';
import { IosCli, Network, WindowsCli, labTwoSubnets } from '@tikshuv/net-sim';
import { DEMO, mountSimStage } from '@tikshuv/sim-kit';
import { mountTerminal, type TerminalBackend, type TerminalHandle } from '@tikshuv/terminal-ui';
import { h, tkButton, tkToast } from '@tikshuv/ui';
import type { App } from '../app';
import { t } from '../i18n';
import type { Screen } from '../router';
import { completeUnits, seedDemo } from '../seed';

interface CliLike {
  prompt(): string;
  exec(line: string): { output: string[]; closed?: boolean };
  complete(line: string): { line: string; candidates: string[] };
  help?(line: string): string[];
}

function adapt(cli: CliLike): TerminalBackend {
  return {
    prompt: () => cli.prompt(),
    execute: (line) => {
      const r = cli.exec(line);
      return { output: r.output.join('\n'), ...(r.closed ? { exit: true } : {}) };
    },
    complete: (partial) => {
      const c = cli.complete(partial);
      const base = partial.replace(/\S*$/, '');
      return c.candidates.length === 1 ? [c.line] : c.candidates.map((x) => base + x);
    },
    help: (partial) => cli.help?.(partial) ?? [],
  };
}

const DEVICES: Array<{ name: string; kind: 'win' | 'ios'; chips: string[] }> = [
  { name: 'PC1', kind: 'win', chips: ['ipconfig', 'arp -a', 'ping 192.168.2.10', 'tracert 192.168.2.10'] },
  { name: 'R1', kind: 'ios', chips: ['enable', 'show ip interface brief', 'show ip route', 'show version'] },
  { name: 'SW1', kind: 'ios', chips: ['enable', 'show mac address-table', 'show version'] },
];

export function labScreen(app: App): Screen {
  app.setMood('mood_terminal');
  const net = new Network(labTwoSubnets);
  let term: TerminalHandle | null = null;
  const termHost = h('div', { class: 'cf-lab__term' });
  const tabs = h('div', { class: 'cf-lab__tabs', role: 'group', 'aria-label': t('lab.devices') });

  const show = (name: string): void => {
    const d = DEVICES.find((x) => x.name === name) ?? DEVICES[0]!;
    term?.destroy();
    termHost.replaceChildren();
    const cli: CliLike = d.kind === 'win' ? new WindowsCli(net, d.name) : new IosCli(net, d.name);
    term = mountTerminal(termHost, adapt(cli), {
      label: t('lab.terminal', { name: d.name }),
      chips: d.chips,
      onSound: (k) => {
        if (k === 'enter') app.audio.play('click');
      },
    });
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset['dev'] === d.name)));
  };
  for (const d of DEVICES) {
    const b = tkButton({ label: d.name, variant: 'secondary', onClick: () => show(d.name) });
    b.dataset['dev'] = d.name;
    b.setAttribute('aria-pressed', 'false');
    tabs.appendChild(b);
  }

  const stageHost = h('div', { class: 'cf-lab__stage' });
  const stage = mountSimStage(stageHost, {
    layout: DEMO.layout,
    trace: DEMO.trace,
    caption: (_e, i) => DEMO.captions[i],
  });

  /* dev switches */
  const select = h('select', { id: 'cf-mood', class: 'cf-select' });
  for (const m of MOOD_IDS) select.appendChild(h('option', { value: m }, m));
  select.addEventListener('change', () => app.setMood(select.value as SceneMoodId));
  const tools = h(
    'div',
    { class: 'cf-lab__tools' },
    tkButton({ label: t('lab.seed'), variant: 'secondary', onClick: () => (seedDemo(app), tkToast({ message: t('lab.done') })) }),
    tkButton({
      label: t('lab.units'),
      variant: 'secondary',
      onClick: () => (completeUnits(app, ['u01_frame_mac', 'u02_switch_table', 'u03_ipv4_mask', 'u04_gateway']), tkToast({ message: t('lab.done') })),
    }),
    tkButton({
      label: t('lab.warn'),
      variant: 'secondary',
      onClick: () => {
        const e = app.timer.elapsed();
        app.timer.setConfig({ warnAtMs: e + 1500, capMs: e + 12_000 });
        tkToast({ message: t('lab.timer.set') });
      },
    }),
    tkButton({
      label: t('lab.blackout'),
      variant: 'secondary',
      onClick: () => {
        const e = app.timer.elapsed();
        app.timer.setConfig({ capMs: e + 1500 });
      },
    }),
    tkButton({ label: t('lab.reset'), variant: 'danger', onClick: () => (app.resetProgress(), tkToast({ message: t('lab.done') })) }),
    h('label', { class: 'cf-field', for: 'cf-mood' }, h('span', {}, t('lab.mood', { n: SCENE_MOODS.length })), select),
  );

  show('PC1');
  const section = (title: string, ...kids: Array<Node | null>): HTMLElement =>
    h('section', { class: 'cf-lab__sec' }, h('h2', { class: 'cf-h2' }, title), ...kids);
  const el = h(
    'div',
    { class: 'cf-lab' },
    h('p', { class: 'cf-hint' }, t('lab.intro')),
    section(t('lab.terminal.h'), tabs, termHost),
    section(t('lab.stage.h'), stageHost),
    section(t('lab.tools.h'), tools),
  );
  return {
    el,
    destroy: () => {
      term?.destroy();
      stage.destroy();
    },
  };
}
