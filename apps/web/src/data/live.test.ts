import { describe, expect, it } from 'vitest';
import { staleKeys } from './live';

describe('staleKeys', () => {
  it('maps event types to the queries they make stale', () => {
    expect(staleKeys('project.connected')).toEqual([['projects'], ['workspace']]);
    expect(staleKeys('workspace.active_project_set')).toEqual([['projects'], ['workspace']]);
    expect(staleKeys('task.status_changed')).toEqual([['work'], ['task']]);
    expect(staleKeys('story.created')).toEqual([['work'], ['task']]);
    expect(staleKeys('run.started')).toEqual([['runs']]);
    expect(staleKeys('step.completed')).toEqual([['runs']]);
    expect(staleKeys('step.message')).toEqual([]);
    expect(staleKeys('decision.made')).toEqual([['runs']]);
    expect(staleKeys('other.thing')).toEqual([]);
  });
});
