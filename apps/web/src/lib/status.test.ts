import { describe, expect, it } from 'vitest';
import { columnOf, columns, coreColumns, statusLabel } from './status';

describe('board columns', () => {
  it('put tasks in the column of their status', () => {
    for (const status of columns) expect(columnOf({ kind: 'task', status })).toBe(status);
  });

  it('put manual tasks where the operator expects them', () => {
    expect(columnOf({ kind: 'manual', status: 'todo' })).toBe('needs_you');
    expect(columnOf({ kind: 'manual', status: 'done' })).toBe('done');
    expect(columnOf({ kind: 'manual', status: 'verified' })).toBe('done');
    expect(columnOf({ kind: 'manual', status: 'cancelled' })).toBe('cancelled');
  });

  it('label every column, and keep core columns a subset', () => {
    for (const column of columns) expect(statusLabel[column]).toBeTruthy();
    for (const column of coreColumns) expect(columns).toContain(column);
  });
});
