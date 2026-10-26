import { describe, expect, it } from 'vitest';
import { screenForPath, screens, taskPath } from './screens';

describe('screens', () => {
  it('has unique ids, paths and shortcut keys', () => {
    for (const field of ['id', 'path', 'key'] as const) {
      expect(new Set(screens.map((s) => s[field])).size).toBe(screens.length);
    }
  });

  it('finds the screen for a path, including nested paths', () => {
    expect(screenForPath('/')?.id).toBe('overview');
    expect(screenForPath('/project/board')?.id).toBe('project');
    expect(screenForPath('/project/backlog')?.id).toBe('project');
    expect(screenForPath('/tasks/1')).toBeUndefined();
  });

  it('encodes task ids in task paths', () => {
    expect(taskPath('a/b')).toBe('/tasks/a%2Fb');
  });
});
