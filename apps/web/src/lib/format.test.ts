import { describe, expect, it } from 'vitest';
import { linesToList, listToLines, patchLineKind, timeAgo } from './format';

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
