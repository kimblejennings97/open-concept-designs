/** Snapshot-based undo/redo. Designs are small, so whole-design JSON snapshots are cheap and simple. */
export class History {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private readonly limit = 200) {}

  /** Call with the state *before* a change, after the change has happened. */
  record(before: string): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: string): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
