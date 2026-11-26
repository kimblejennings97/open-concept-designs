import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History();
    h.record('a'); // a -> b
    h.record('b'); // b -> c
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeNull();
    expect(h.redo('a')).toBe('b');
    expect(h.redo('b')).toBe('c');
    expect(h.redo('c')).toBeNull();
  });

  it('a new change clears redo', () => {
    const h = new History();
    h.record('a');
    h.undo('b');
    expect(h.canRedo).toBe(true);
    h.record('a');
    expect(h.canRedo).toBe(false);
  });

  it('respects the limit', () => {
    const h = new History(2);
    h.record('a');
    h.record('b');
    h.record('c');
    expect(h.undo('d')).toBe('c');
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBeNull();
  });
});
