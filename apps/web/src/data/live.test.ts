import { describe, expect, it } from 'vitest';
import { staleKeys } from './live';

describe('staleKeys', () => {
  it('maps event types to the queries they make stale', () => {
    expect(staleKeys('project.connected')).toEqual([['projects'], ['workspace']]);
    expect(staleKeys('workspace.active_project_set')).toEqual([['projects'], ['workspace']]);
    expect(staleKeys('task.status_changed')).toEqual([['work'], ['task'], ['queue']]);
    expect(staleKeys('story.created')).toEqual([['work'], ['task'], ['queue']]);
    expect(staleKeys('dependency.added')).toEqual([['work'], ['task'], ['queue']]);
    expect(staleKeys('scheduler.paused')).toEqual([['queue']]);
    expect(staleKeys('run.started')).toEqual([['runs'], ['queue']]);
    expect(staleKeys('step.completed')).toEqual([['runs']]);
    expect(staleKeys('step.message')).toEqual([]);
    expect(staleKeys('decision.made')).toEqual([['runs']]);
    expect(staleKeys('other.thing')).toEqual([]);
  });
});
