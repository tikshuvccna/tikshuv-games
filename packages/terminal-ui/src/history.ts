/** Command history with up/down navigation that preserves the in-progress draft. */
export class History {
  private items: string[] = [];
  private cursor = -1; // -1 = not navigating
  private draft = '';

  constructor(private readonly max = 200) {}

  get entries(): readonly string[] {
    return this.items;
  }

  /** Record a command. Blank lines and immediate repeats are skipped. Resets navigation. */
  push(line: string): void {
    this.cursor = -1;
    this.draft = '';
    if (!line.trim() || this.items[this.items.length - 1] === line) return;
    this.items.push(line);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  /** Older entry; `current` is stored as the draft on the first step. */
  up(current: string): string {
    if (this.items.length === 0) return current;
    if (this.cursor === -1) {
      this.draft = current;
      this.cursor = this.items.length - 1;
    } else if (this.cursor > 0) {
      this.cursor -= 1;
    }
    return this.items[this.cursor] ?? current;
  }

  /** Newer entry; past the newest, returns the draft. */
  down(current: string): string {
    if (this.cursor === -1) return current;
    if (this.cursor < this.items.length - 1) {
      this.cursor += 1;
      return this.items[this.cursor] ?? current;
    }
    this.cursor = -1;
    return this.draft;
  }

  resetNavigation(): void {
    this.cursor = -1;
  }
}
