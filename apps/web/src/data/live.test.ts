import { describe, expect, it } from 'vitest';
import { staleKeys } from './live';

describe('staleKeys', () => {
  it('refreshes projects and workspace on project and workspace events', () => {
    expect(staleKeys('project.connected')).toEqual([['projects'], ['workspace']]);
    expect(staleKeys('workspace.active_project_set')).toEqual([['projects'], ['workspace']]);
    expect(staleKeys('task.created')).toEqual([]);
  });
});
