/**
 * Demo with a fake echo backend (not wired into the game).
 * Usage in any page that already loads @tikshuv/ui tokens:
 *   import { mountDemo } from '@tikshuv/terminal-ui/demo/demo';
 *   mountDemo(document.getElementById('host')!);
 */
import { mountTerminal, type TerminalBackend, type TerminalHandle } from '../src/index';

const COMMANDS = ['echo', 'help', 'clear', 'exit', 'time'];

export const echoBackend: TerminalBackend = {
  prompt: () => 'demo>',
  execute(line) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    if (cmd === 'echo') return { output: rest.join(' ') };
    if (cmd === 'clear') return { output: '', clear: true };
    if (cmd === 'exit') return { output: 'session closed', exit: true };
    if (cmd === 'time') return { output: new Date().toISOString() };
    if (cmd === 'help') return { output: COMMANDS.join('\n') };
    return { output: `unknown command: ${cmd}` };
  },
  complete: (p) => COMMANDS.filter((c) => c.startsWith(p)),
  help: (p) => COMMANDS.filter((c) => c.startsWith(p.trim())).map((c) => `  ${c}`),
};

export function mountDemo(host: HTMLElement): TerminalHandle {
  return mountTerminal(host, echoBackend, {
    label: 'Demo terminal',
    banner: 'Demo terminal. Try: echo hello, Tab, ?, Up/Down.',
    chips: ['help', 'echo hello', 'time', 'clear'],
    reveal: { charsPerSecond: 300 },
    onSound: () => {},
  });
}
