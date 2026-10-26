import { join } from 'node:path';
import { chatViewSchema } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { ScriptedRuntime } from '../test/scriptedRuntime';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();
const post = (body: unknown = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('chat', () => {
  it("answers with the chat agent, Megalodon's MCP tools and the operator's context", async () => {
    const runtime = new ScriptedRuntime();
    const { chat, projects, work, app } = createTestServer(tempDir(), runtime);
    const project = await projects.connect(initRepo(join(tempDir(), 'shop')));
    const task = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Checkout', description: '' });

    const sent = await app.request(url('/api/chat/messages'), post({ text: 'What is this task about?', context: { projectId: project.id, taskId: task.id } }));
    expect(sent.status).toBe(202);
    await chat.idle();

    const call = runtime.calls[0]!;
    expect(call.agent).toMatchObject({ id: 'chat', mcpServers: { megalodon: { type: 'http', url: url('/mcp') } } });
    expect(call.agent.tools).toContain('mcp__megalodon');
    expect(call.cwd).toBe(project.path);
    expect(call.prompt).toContain('Active project: shop');
    expect(call.prompt).toContain('Open: task #1 "Checkout"');
    expect(call.prompt.endsWith('What is this task about?')).toBe(true);

    const view = chatViewSchema.parse(await (await app.request(url('/api/chat'))).json());
    expect(view.busy).toBe(false);
    expect(view.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'What is this task about?'],
      ['assistant', 'Assistant is working.'],
    ]);
  });

  it('continues the agent session within a conversation, and starts a new one on request', async () => {
    const runtime = new ScriptedRuntime();
    const { chat } = createTestServer(tempDir(), runtime);
    chat.send('one', { projectId: null, taskId: null, runId: null });
    await chat.idle();
    chat.send('two', { projectId: null, taskId: null, runId: null });
    await chat.idle();
    chat.reset();
    chat.send('three', { projectId: null, taskId: null, runId: null });
    await chat.idle();

    expect(runtime.calls.map((c) => c.resumeSessionId)).toEqual([undefined, 'session-1', undefined]);
    expect(chat.view().messages.map((m) => m.text)).toEqual(['three', 'Assistant is working.']);
  });

  it('takes one message at a time and reports failures in the conversation', async () => {
    const runtime = new ScriptedRuntime((_, call) => (call === 1 ? { hang: true } : { ok: false, error: 'boom' }));
    const { chat } = createTestServer(tempDir(), runtime);
    chat.send('first', { projectId: null, taskId: null, runId: null });
    expect(() => chat.send('second', { projectId: null, taskId: null, runId: null })).toThrow(expect.objectContaining({ code: 'CHAT_BUSY' }));
  });

  it('closes a conversation a restart left busy', async () => {
    const dir = tempDir();
    const first = createTestServer(dir, new ScriptedRuntime(() => ({ hang: true })));
    first.chat.send('hello', { projectId: null, taskId: null, runId: null });
    const second = createTestServer(dir);
    second.chat.recover();
    expect(second.chat.view()).toMatchObject({ busy: false });
    expect(second.chat.view().messages.at(-1)?.text).toContain('Megalodon restarted');
  });
});
