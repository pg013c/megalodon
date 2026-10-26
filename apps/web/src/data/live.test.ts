import { describe, expect, it } from 'vitest';
import { staleKeys } from './live';

describe('staleKeys', () => {
  it('maps event types to the queries they make stale', () => {
    expect(staleKeys('project.connected')).toEqual([['projects'], ['workspace'], ['overview']]);
    expect(staleKeys('workspace.active_project_set')).toEqual([['projects'], ['workspace'], ['overview']]);
    expect(staleKeys('task.status_changed')).toEqual([['work'], ['task'], ['queue'], ['needs-you'], ['overview']]);
    expect(staleKeys('story.created')).toEqual([['work'], ['task'], ['queue'], ['needs-you'], ['overview']]);
    expect(staleKeys('dependency.added')).toEqual([['work'], ['task'], ['queue'], ['needs-you'], ['overview']]);
    expect(staleKeys('scheduler.paused')).toEqual([['queue'], ['needs-you'], ['overview']]);
    expect(staleKeys('merge.blocked')).toEqual([['work'], ['task'], ['queue'], ['needs-you'], ['overview']]);
    expect(staleKeys('run.started')).toEqual([['runs'], ['queue'], ['needs-you'], ['overview']]);
    expect(staleKeys('step.completed')).toEqual([['runs'], ['overview']]);
    expect(staleKeys('step.message')).toEqual([]);
    expect(staleKeys('decision.made')).toEqual([['runs'], ['needs-you'], ['overview']]);
    expect(staleKeys('other.thing')).toEqual([]);
  });
});
