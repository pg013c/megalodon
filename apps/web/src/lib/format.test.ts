import { describe, expect, it } from 'vitest';
import { cost, duration, linesToList, listToLines, patchLineKind, timeAgo, tokens } from './format';

describe('timeAgo', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  it('describes the distance in the largest fitting unit', () => {
    expect(timeAgo('2026-10-26T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-26T09:00:00Z', now)).toBe('3 hours ago');
    expect(timeAgo('2026-10-25T12:00:00Z', now)).toBe('yesterday');
  });
});

describe('patchLineKind', () => {
  it('classifies unified diff lines', () => {
    expect(patchLineKind('+++ b/a.txt')).toBe('meta');
    expect(patchLineKind('@@ -1 +1,2 @@')).toBe('hunk');
    expect(patchLineKind('+added')).toBe('add');
    expect(patchLineKind('-removed')).toBe('remove');
    expect(patchLineKind(' same')).toBe('context');
  });
});

describe('lines', () => {
  it('drops empty lines and trims', () => {
    expect(linesToList(' a \n\n b\n')).toEqual(['a', 'b']);
    expect(listToLines(['a', 'b'])).toBe('a\nb');
  });
});

describe('run numbers', () => {
  it('formats durations, costs and token counts', () => {
    expect(duration(null)).toBe('—');
    expect(duration(850)).toBe('850ms');
    expect(duration(134_000)).toBe('2m 14s');
    expect(duration(3_780_000)).toBe('1h 3m');
    expect(cost(0)).toBe('$0');
    expect(cost(0.004)).toBe('<$0.01');
    expect(cost(1.234)).toBe('$1.23');
    expect(tokens(950)).toBe('950');
    expect(tokens(12_345)).toBe('12k');
    expect(tokens(1_234)).toBe('1.2k');
    expect(tokens(1_234_567)).toBe('1.2M');
  });
});
