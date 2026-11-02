import { describe, expect, it, vi } from 'vitest';
import type { ExecuteResult, SoundKind, TerminalBackend } from './backend';
import { commonPrefix, complete, parseHelpRequest, revealSlice, splitOutput } from './completion';
import { History } from './history';
import { TerminalSession } from './session';

const CMDS = ['show ip route', 'show ip interface', 'show version', 'ping', 'clear', 'exit'];

function backend(extra: Partial<TerminalBackend> = {}): TerminalBackend {
  return {
    prompt: () => 'R#',
    execute: (line): ExecuteResult => {
      if (line === 'clear') return { output: '', clear: true };
      if (line === 'exit') return { output: 'bye\n', exit: true };
      return { output: `ran ${line}\nline2\n` };
    },
    complete: (p) => CMDS.filter((c) => c.startsWith(p)),
    help: (p) => CMDS.filter((c) => c.startsWith(p)).map((c) => `  ${c}`),
    ...extra,
  };
}

describe('History', () => {
  it('navigates and restores the draft', () => {
    const h = new History();
    h.push('a');
    h.push('b');
    expect(h.up('draft')).toBe('b');
    expect(h.up('x')).toBe('a');
    expect(h.up('x')).toBe('a');
    expect(h.down('x')).toBe('b');
    expect(h.down('x')).toBe('draft');
    expect(h.down('x')).toBe('x');
  });
  it('skips blanks and repeats, caps size, empty up is a no-op', () => {
    const h = new History(2);
    expect(h.up('q')).toBe('q');
    h.push('  ');
    h.push('a');
    h.push('a');
    h.push('b');
    h.push('c');
    expect(h.entries).toEqual(['b', 'c']);
    h.up('');
    h.resetNavigation();
    expect(h.down('z')).toBe('z');
  });
});

describe('completion', () => {
  it('commonPrefix', () => {
    expect(commonPrefix([])).toBe('');
    expect(commonPrefix(['show ip route', 'show ip interface'])).toBe('show ip ');
    expect(commonPrefix(['abc', 'xyz'])).toBe('');
  });
  it('single match completes with a space', () => {
    expect(complete('pi', CMDS)).toMatchObject({ kind: 'single', line: 'ping ' });
    expect(complete('x', ['x '])).toMatchObject({ line: 'x ' });
  });
  it('multiple extends to the common prefix and lists', () => {
    const r = complete('sh', CMDS);
    expect(r.kind).toBe('multiple');
    expect(r.line).toBe('show ');
    expect(r.candidates).toHaveLength(3);
    expect(complete('show ', CMDS).line).toBe('show ');
  });
  it('none, case-insensitive, filters bad candidates, dedupes', () => {
    expect(complete('zz', CMDS)).toEqual({ kind: 'none', line: 'zz', candidates: [] });
    expect(complete('PI', ['ping'])).toMatchObject({ kind: 'single' });
    expect(complete('a', ['b', 'a1', 'a1'])).toMatchObject({ kind: 'single', line: 'a1 ' });
  });
  it('help request, output split, reveal', () => {
    expect(parseHelpRequest('show ?')).toBe('show ');
    expect(parseHelpRequest('show')).toBeNull();
    expect(splitOutput('')).toEqual([]);
    expect(splitOutput('a\r\nb\n')).toEqual(['a', 'b']);
    expect(splitOutput('\n')).toEqual(['']);
    expect(revealSlice('hello', 0, 2.9)).toBe(2);
    expect(revealSlice('hi', 1, 10)).toBe(2);
    expect(revealSlice('hi', 0, 0)).toBe(1);
  });
});

describe('TerminalSession', () => {
  it('runs a command, records history, fires hooks', async () => {
    const sounds: SoundKind[] = [];
    const onCommand = vi.fn();
    const s = new TerminalSession(backend(), { onSound: (k) => sounds.push(k), onCommand });
    s.setInput('ping');
    await s.submit();
    expect(s.lines.map((l) => [l.kind, l.text])).toEqual([
      ['input', 'ping'],
      ['output', 'ran ping'],
      ['output', 'line2'],
    ]);
    expect(s.lines[0]?.prompt).toBe('R#');
    expect(s.input).toBe('');
    expect(s.history.entries).toEqual(['ping']);
    expect(onCommand).toHaveBeenCalledWith('ping', { output: 'ran ping\nline2\n' });
    expect(sounds).toEqual(['enter', 'output']);
  });
  it('blank line only echoes the prompt', async () => {
    const s = new TerminalSession(backend());
    await s.submit('   ');
    expect(s.lines).toHaveLength(1);
    expect(s.history.entries).toEqual([]);
  });
  it('supports async backends and busy state', async () => {
    const s = new TerminalSession(backend({ execute: async () => ({ output: 'late' }) }));
    const events: string[] = [];
    s.subscribe((e) => e.type === 'busy' && events.push(String(e.busy)));
    const p = s.submit('x');
    expect(s.busy).toBe(true);
    await s.submit('ignored while busy');
    await p;
    expect(s.busy).toBe(false);
    expect(events).toEqual(['true', 'false']);
  });
  it('clear and exit', async () => {
    const s = new TerminalSession(backend());
    await s.submit('ping');
    await s.submit('clear');
    expect(s.lines.map((l) => l.text)).toEqual([]);
    await s.submit('exit');
    expect(s.exited).toBe(true);
    const n = s.lines.length;
    await s.submit('ping');
    s.tab();
    expect(s.lines).toHaveLength(n);
  });
  it('backend failure resets busy', async () => {
    const s = new TerminalSession(
      backend({
        execute: () => {
          throw new Error('boom');
        },
      }),
    );
    await expect(s.submit('x')).rejects.toThrow('boom');
    expect(s.busy).toBe(false);
  });
  it('history up/down through the session', async () => {
    const s = new TerminalSession(backend());
    await s.submit('ping');
    s.setInput('dra');
    s.historyUp();
    expect(s.input).toBe('ping');
    s.historyDown();
    expect(s.input).toBe('dra');
  });
  it('tab: single, multiple, none', () => {
    const sounds: SoundKind[] = [];
    const s = new TerminalSession(backend(), { onSound: (k) => sounds.push(k) });
    s.setInput('pi');
    s.tab();
    expect(s.input).toBe('ping ');
    s.setInput('show ');
    s.tab();
    expect(s.input).toBe('show ');
    expect(s.lines.at(-1)).toMatchObject({ kind: 'list', text: 'show ip route  show ip interface  show version' });
    const before = s.lines.length;
    s.setInput('qq');
    s.tab();
    expect(s.lines).toHaveLength(before);
    expect(sounds).toEqual(['tab', 'tab', 'tab']);
  });
  it('? help strips the question mark, via help() and submit()', async () => {
    const s = new TerminalSession(backend());
    expect(s.help()).toBe(false);
    s.setInput('show ip ?');
    expect(s.help()).toBe(true);
    expect(s.input).toBe('show ip ');
    expect(s.lines.filter((l) => l.kind === 'help').map((l) => l.text)).toEqual(['  show ip route', '  show ip interface']);
    await s.submit('pi?');
    expect(s.input).toBe('pi');
    expect(s.history.entries).toEqual([]);
  });
  it('caps scrollback and prints info', () => {
    const s = new TerminalSession(backend(), { maxLines: 2 });
    s.print('a\nb\nc', 'info');
    expect(s.lines.map((l) => l.text)).toEqual(['b', 'c']);
    expect(s.lines[0]?.kind).toBe('info');
  });
  it('unsubscribe stops events', () => {
    const s = new TerminalSession(backend());
    const fn = vi.fn();
    s.subscribe(fn)();
    s.print('x');
    expect(fn).not.toHaveBeenCalled();
  });
});
