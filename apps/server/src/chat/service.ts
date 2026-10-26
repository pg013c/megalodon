import { randomUUID } from 'node:crypto';
import { chatEvents, chatStream, type Actor, type ChatContext, type ChatView } from '@megalodon/contracts';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import type { Library } from '../library/library';
import type { ProjectsQueries } from '../projects/projection';
import type { RunsQueries } from '../runs/projection';
import type { AgentRuntime } from '../runtime/types';
import type { WorkQueries } from '../work/projection';
import type { ChatQueries } from './projection';

const OPERATOR: Actor = { kind: 'operator' };
const SYSTEM: Actor = { kind: 'system' };
const TOOL_PREFIX = 'mcp__megalodon__';

export interface ChatDeps {
  store: EventStore;
  queries: ChatQueries;
  projects: ProjectsQueries;
  work: WorkQueries;
  runs: RunsQueries;
  library: Library;
  runtime: AgentRuntime;
  /** Megalodon's own MCP endpoint, the chat agent's tools (ADR-0030). */
  mcpUrl: string;
  dataDir: string;
  env: Record<string, string>;
}

/**
 * The chat in Megalodon (PRD FR-17): the `chat` agent with Megalodon's MCP tools, one
 * conversation at a time, continued as one agent session. Messages are events in `chat:<id>`.
 */
export class ChatService {
  private working: Promise<void> | null = null;

  constructor(private readonly deps: ChatDeps) {}

  view(): ChatView {
    const conversation = this.deps.queries.latest();
    if (!conversation) return { conversationId: null, busy: false, messages: [] };
    return { conversationId: conversation.id, busy: conversation.busy, messages: this.deps.queries.messages(conversation.id) };
  }

  /** Starts a new conversation; the next message opens a new agent session. */
  reset(): ChatView {
    if (this.deps.queries.latest()?.busy) throw new AppError(409, 'CHAT_BUSY', 'Wait for the answer first');
    const conversationId = randomUUID();
    this.deps.store.append([{ type: chatEvents.started, stream: chatStream(conversationId), data: { conversationId }, actor: OPERATOR }]);
    return this.view();
  }

  send(text: string, context: ChatContext): ChatView {
    let conversation = this.deps.queries.latest();
    if (conversation?.busy) throw new AppError(409, 'CHAT_BUSY', 'Wait for the answer first');
    if (!conversation) {
      this.reset();
      conversation = this.deps.queries.latest()!;
    }
    const id = conversation.id;
    this.deps.store.append([{ type: chatEvents.message, stream: chatStream(id), data: { conversationId: id, role: 'user', text, tool: null }, actor: OPERATOR }]);
    this.working = this.answer(id, conversation.sessionId, text, context).finally(() => {
      this.working = null;
    });
    return this.view();
  }

  /** On startup: a conversation left busy by a stopped server is closed with a note. */
  recover(): void {
    const conversation = this.deps.queries.latest();
    if (conversation?.busy) this.finish(conversation.id, 'Megalodon restarted before the answer was complete.');
  }

  async idle(): Promise<void> {
    while (this.working) await this.working;
  }

  private async answer(conversationId: string, sessionId: string | null, text: string, context: ChatContext): Promise<void> {
    const base = this.deps.library.agent('chat');
    const agent = {
      ...base,
      tools: [...base.tools, 'mcp__megalodon'],
      mcpServers: { ...base.mcpServers, megalodon: { type: 'http' as const, url: this.deps.mcpUrl } },
    };
    const project = context.projectId ? this.deps.projects.get(context.projectId) : null;
    let error: string | null = null;
    try {
      for await (const event of this.deps.runtime.run({
        agent,
        cwd: project?.path ?? this.deps.dataDir,
        prompt: `${this.contextLine(context)}\n\n${text}`,
        env: this.deps.env,
        signal: new AbortController().signal,
        ...(sessionId ? { resumeSessionId: sessionId } : {}),
      })) {
        if (event.type === 'session' && event.sessionId !== sessionId) {
          this.append(conversationId, chatEvents.session, { conversationId, sessionId: event.sessionId });
        }
        if (event.type === 'message' && event.message.kind === 'text') this.say(conversationId, 'assistant', event.message.text, null);
        if (event.type === 'message' && event.message.kind === 'tool_use') {
          const name = event.message.name.startsWith(TOOL_PREFIX) ? event.message.name.slice(TOOL_PREFIX.length) : event.message.name;
          this.say(conversationId, 'tool', event.message.input, name);
        }
        if (event.type === 'result' && !event.ok) error = event.error ?? 'The assistant failed';
      }
    } catch (e) {
      error = (e as Error).message;
    }
    this.finish(conversationId, error);
  }

  /** The context line every message starts with: the active project and the open item. */
  private contextLine(context: ChatContext): string {
    const parts = [`Today is ${new Date().toISOString().slice(0, 10)}.`];
    const project = context.projectId ? this.deps.projects.get(context.projectId) : null;
    parts.push(project ? `Active project: ${project.name} (id ${project.id}).` : 'No active project.');
    const task = context.taskId ? this.deps.work.task(context.taskId) : null;
    if (task) parts.push(`Open: task #${task.number} "${task.title}" (id ${task.id}, ${task.status}).`);
    const run = context.runId ? this.deps.runs.run(context.runId) : null;
    if (run) parts.push(`Open: run ${run.id} of ${run.pipelineId} on ${run.branch} (${run.status}).`);
    return `[Context] ${parts.join(' ')}`;
  }

  private say(conversationId: string, role: 'assistant' | 'tool', text: string, tool: string | null): void {
    this.append(conversationId, chatEvents.message, { conversationId, role, text, tool });
  }

  private finish(conversationId: string, error: string | null): void {
    if (error) this.say(conversationId, 'assistant', `⚠️ ${error}`, null);
    this.append(conversationId, chatEvents.finished, { conversationId, error });
  }

  private append(conversationId: string, type: string, data: unknown): void {
    this.deps.store.append([{ type, stream: chatStream(conversationId), data, actor: SYSTEM }]);
  }
}
