/** Contract a command host (net-sim device, fake echo, ...) implements for the terminal widget. */
export interface ExecuteResult {
  output: string;
  clear?: boolean;
  exit?: boolean;
}

export interface TerminalBackend {
  /** Current prompt, e.g. `C:\>` or `Router#`. May change after each command. */
  prompt(): string;
  execute(line: string): ExecuteResult | Promise<ExecuteResult>;
  /** Full-line completions for a partial line. */
  complete(partial: string): string[];
  /** Help entries (one per line) for a partial line, shown by a trailing `?`. */
  help(partial: string): string[];
}

export type SoundKind = 'key' | 'enter' | 'output' | 'tab' | 'error' | 'clear';
