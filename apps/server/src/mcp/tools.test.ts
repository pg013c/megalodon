import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

/** An MCP client talking to the app in-process, through the real /mcp route. */
async function connect(app: ReturnType<typeof createTestServer>['app']) {
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(url('/mcp')), {
    fetch: (input, init) => Promise.resolve(app.request(input instanceof Request ? input : String(input), init)),
  });
  await client.connect(transport);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { error: result.isError ?? false, value: JSON.parse(result.content[0]!.text.startsWith('{') || result.content[0]!.text.startsWith('[') ? result.content[0]!.text : JSON.stringify(result.content[0]!.text)) };
};

describe('MCP', () => {
  it('lists every command and query as a tool', async () => {
    const { app } = createTestServer(tempDir());
    const client = await connect(app);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ['list_projects', 'get_project_work', 'create_task', 'add_dependency', 'start_run', 'override_decision', 'merge_task', 'get_needs_you', 'get_overview', 'pause_queue']) {
      expect(names).toContain(name);
    }
    expect(names.length).toBeGreaterThanOrEqual(38);
  });

  it('works on the active project and resolves tasks by number', async () => {
    const { app, projects, work } = createTestServer(tempDir());
    const project = await projects.connect(initRepo(join(tempDir(), 'shop')));
    const client = await connect(app);

    const users = await call(client, 'create_task', { title: 'Users' });
    expect(users.value).toMatchObject({ number: 1, kind: 'task', projectId: project.id });
    const key = await call(client, 'create_task', { kind: 'manual', title: 'Stripe key' });
    await call(client, 'create_task', { title: 'Payments' });
    expect((await call(client, 'add_dependency', { task: '#3', kind: 'code', target: '1' })).error).toBe(false);
    expect((await call(client, 'add_dependency', { task: '3', kind: 'manual', target: '#2' })).error).toBe(false);
    expect((await call(client, 'complete_manual_task', { task: '#2' })).value).toMatchObject({ status: 'done' });

    const details = await call(client, 'get_task', { task: '#3' });
    expect(details.value.requirements.map((r: { label: string; met: boolean }) => [r.label, r.met])).toEqual([
      ['#1 Users', false],
      ['#2 Stripe key', true],
    ]);
    expect(work.queries.task(key.value.id)?.status).toBe('done');
  });

  it('reports errors as tool errors with the API message', async () => {
    const { app } = createTestServer(tempDir());
    const client = await connect(app);
    const result = await call(client, 'get_task', { task: '#9' });
    expect(result).toEqual({ error: true, value: 'No project given and no active project' });
  });

  it('changes settings by patch and controls the queue', async () => {
    const { app, projects } = createTestServer(tempDir());
    const project = await projects.connect(initRepo(join(tempDir(), 'shop')));
    const client = await connect(app);
    await call(client, 'update_project_settings', { changes: { sensitivePaths: ['src/auth/**'] } });
    expect(projects.get(project.id).settings.sensitivePaths).toEqual(['src/auth/**']);
    expect((await call(client, 'pause_queue')).value).toMatchObject({ paused: 'operator' });
    expect((await call(client, 'get_queue')).value.state.paused).toBe('operator');
  });
});
