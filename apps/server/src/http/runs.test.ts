import { join } from 'node:path';
import { agentSchema, apiErrorSchema, decisionSchema, pipelineSchema, runDetailsSchema, runSchema } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();
const post = (body: unknown = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('run routes', () => {
  it('lists agents, starts a run and reads its details', async () => {
    const { app, projects, work, runs } = createTestServer(tempDir());
    const project = await projects.connect(initRepo(join(tempDir(), 'shop')));
    const task = work.createTask(project.id, { kind: 'task', storyId: null, title: 'T', description: '' });

    const agents = agentSchema.array().parse(await (await app.request(url('/api/agents'))).json());
    expect(agents.map((a) => a.id)).toContain('implementer');

    const pipelines = pipelineSchema.array().parse(await (await app.request(url('/api/pipelines'))).json());
    expect(pipelines.map((p) => p.id)).toContain('feature');

    const both = await app.request(url(`/api/tasks/${task.id}/runs`), post({ pipelineId: 'feature', agentId: 'implementer' }));
    expect(apiErrorSchema.parse(await both.json()).error.code).toBe('INVALID_REQUEST');

    const started = await app.request(url(`/api/tasks/${task.id}/runs`), post({ agentId: 'implementer' }));
    expect(started.status).toBe(201);
    const run = runSchema.parse(await started.json());
    await runs.idle();

    const details = runDetailsSchema.parse(await (await app.request(url(`/api/runs/${run.id}`))).json());
    expect(details.run.status).toBe('succeeded');
    expect(runSchema.array().parse(await (await app.request(url(`/api/tasks/${task.id}/runs`))).json())).toHaveLength(1);

    const stop = await app.request(url(`/api/runs/${run.id}/stop`), post());
    expect(apiErrorSchema.parse(await stop.json()).error.code).toBe('RUN_NOT_RUNNING');

    expect(decisionSchema.array().parse(await (await app.request(url(`/api/tasks/${task.id}/decisions`))).json())).toEqual([]);
    const missing = await app.request(url('/api/decisions/nope/override'), post({ outcome: 'pass', rationale: 'x' }));
    expect(apiErrorSchema.parse(await missing.json()).error.code).toBe('DECISION_NOT_FOUND');
  });
});
