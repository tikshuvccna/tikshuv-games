/**
 * @tikshuv/terminal-ui - LTR terminal widget. Headless logic (session, history, completion)
 * is DOM-free; mountTerminal() is the thin DOM layer. Binds to any TerminalBackend (net-sim later).
 * Needs @tikshuv/ui tokens loaded on the page.
 */
export type { TerminalBackend, ExecuteResult, SoundKind } from './backend';
export { History } from './history';
export { complete, commonPrefix, parseHelpRequest, splitOutput, revealSlice } from './completion';
export type { Completion } from './completion';
export { TerminalSession } from './session';
export type { OutputLine, LineKind, SessionEvent, SessionOptions } from './session';
export { mountTerminal } from './terminal';
export type { TerminalOptions, TerminalHandle } from './terminal';
