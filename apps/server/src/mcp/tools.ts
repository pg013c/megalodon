import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { periodSchema, projectSettingsSchema, taskKindSchema, type ProjectSettings, type Task } from '@megalodon/contracts';
import { z } from 'zod';
import type { DecisionService } from '../decisions/service';
import { AppError } from '../errors';
import type { Library } from '../library/library';
import type { MergeService } from '../merge/service';
import type { NeedsYouService } from '../needsYou/service';
import type { OverviewService } from '../overview/service';
import type { ProjectService } from '../projects/service';
import type { RunService } from '../runs/service';
import type { Scheduler } from '../scheduler/service';
import type { TriageService } from '../triage/service';
import type { WorkService } from '../work/service';

export interface McpDeps {
  version: string;
  projects: ProjectService;
  work: WorkService;
  runs: RunService;
  decisions: DecisionService;
  triage: TriageService;
  scheduler: Scheduler;
  merges: MergeService;
  needsYou: NeedsYouService;
  overview: OverviewService;
  library: Library;
}

const taskRef = z.string().describe('A task id, or its number like "12" or "#12" (in projectId, or the active project).');
const projectRef = z.string().optional().describe('Project id; defaults to the active project.');

/**
 * Megalodon's commands and queries as MCP tools (ADR-0030). They call the same services as the
 * HTTP API and act as the operator. Errors come back as tool errors with the API's message.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'megalodon', version: deps.version });
  const { projects, work, runs, decisions, triage, scheduler, merges } = deps;

  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.infer<z.ZodObject<S>>) => unknown) =>
    server.registerTool(name, { description, inputSchema: shape }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        const result = await run(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { ok: true }, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
      }
    }) as never);

  const project = (id?: string) => {
    const resolved = id ?? projects.activeProjectId();
    if (!resolved) throw new AppError(400, 'NO_PROJECT', 'No project given and no active project');
    return projects.get(resolved);
  };
  const task = (ref: string, projectId?: string): Task => {
    const number = /^#?(\d+)$/.exec(ref.trim());
    if (!number) {
      const found = work.queries.task(ref);
      if (!found) throw new AppError(404, 'TASK_NOT_FOUND', `No task ${ref}`);
      return found;
    }
    const target = work.queries.byNumber(project(projectId).id, Number(number[1]));
    if (!target || target.type !== 'task') throw new AppError(404, 'TASK_NOT_FOUND', `No task #${number[1]}`);
    return work.queries.task(target.id)!;
  };

  // Queries

  tool('list_projects', 'Connected projects with their settings.', {}, () => projects.list());
  tool('get_workspace', 'The active project, the working context of the operator.', {}, () => {
    const id = projects.activeProjectId();
    return { activeProject: id ? projects.get(id) : null };
  });
  tool('get_project_work', "A project's stories, tasks and what each task needs to start.", { projectId: projectRef }, ({ projectId }) =>
    work.work(project(projectId).id),
  );
  tool('get_task', 'A task with its story, dependencies, requirements and history.', { task: taskRef, projectId: projectRef }, (a) =>
    work.details(task(a.task, a.projectId).id),
  );
  tool('list_task_runs', 'The runs of a task, newest first.', { task: taskRef, projectId: projectRef }, (a) => runs.forTask(task(a.task, a.projectId).id));
  tool(
    'get_run',
    'A run: its pipeline plan, step attempts with cost, and the last timeline entries (messages and decisions).',
    { runId: z.string(), last: z.number().int().min(0).max(500).default(40).describe('How many timeline entries to return.') },
    ({ runId, last }) => {
      const details = runs.details(runId);
      return { ...details, timeline: last ? details.timeline.slice(-last) : [] };
    },
  );
  tool('get_needs_you', 'Everything waiting for the operator across projects, oldest first.', {}, () => deps.needsYou.view());
  tool('get_queue', 'The global queue: slots, pause, running and waiting tasks.', {}, () => scheduler.view());
  tool('get_overview', 'Every project at a glance, with spend for a period.', { period: periodSchema.default('7d') }, ({ period }) => deps.overview.view(period));
  tool('list_agents', 'Agents in the library.', {}, () => deps.library.agents().map(({ instructions: _, ...agent }) => agent));
  tool('list_pipelines', 'Pipelines in the library.', {}, () => deps.library.pipelines());
  tool('list_branches', "A project's branches with ahead/behind the base.", { projectId: projectRef }, ({ projectId }) => projects.branches(project(projectId).id));
  tool('get_branch_diff', 'Files a branch changed since it left the base.', { branch: z.string(), projectId: projectRef }, (a) => projects.diff(project(a.projectId).id, a.branch));

  // Projects

  tool('connect_project', 'Connects a local git repository (its root) as a project.', { path: z.string() }, ({ path }) => projects.connect(path));
  tool('set_active_project', 'Makes a project the active one (null clears it).', { projectId: z.string().nullable() }, ({ projectId }) => {
    projects.setActive(projectId);
    return { activeProjectId: projects.activeProjectId() };
  });
  tool(
    'update_project_settings',
    'Changes project settings: give only the fields to change (checks, setup, sensitivePaths, policies, maxParallel, …).',
    { projectId: projectRef, changes: z.record(z.string(), z.unknown()) },
    ({ projectId, changes }) => {
      const current = project(projectId);
      const settings: ProjectSettings = projectSettingsSchema.parse({ ...current.settings, ...changes });
      return projects.updateSettings(current.id, settings);
    },
  );

  // Work

  tool('create_story', 'Adds a story to a project.', { projectId: projectRef, title: z.string(), description: z.string().default('') }, (a) =>
    work.createStory(project(a.projectId).id, { title: a.title, description: a.description }),
  );
  tool(
    'create_task',
    'Adds a task (for agents) or a manual task (for the operator). A new task is triaged and queued by itself.',
    {
      projectId: projectRef,
      kind: taskKindSchema.default('task'),
      title: z.string(),
      description: z.string().default(''),
      story: z.string().optional().describe('Story id or number.'),
    },
    (a) => {
      const projectId = project(a.projectId).id;
      const storyNumber = a.story ? /^#?(\d+)$/.exec(a.story) : null;
      const storyId = storyNumber ? (work.queries.byNumber(projectId, Number(storyNumber[1]))?.id ?? null) : (a.story ?? null);
      return work.createTask(projectId, { kind: a.kind, storyId, title: a.title, description: a.description });
    },
  );
  tool(
    'update_task',
    "Changes a task's title, description or story.",
    { task: taskRef, projectId: projectRef, title: z.string().optional(), description: z.string().optional(), storyId: z.string().nullable().optional() },
    ({ task: ref, projectId, ...changes }) => work.updateTask(task(ref, projectId).id, changes),
  );
  tool('cancel_task', 'Cancels a task for good (stops its run).', { task: taskRef, projectId: projectRef, reason: z.string().optional() }, (a) =>
    work.cancel(task(a.task, a.projectId).id, a.reason),
  );
  tool('complete_manual_task', 'Marks a manual task done.', { task: taskRef, projectId: projectRef }, (a) => work.complete(task(a.task, a.projectId).id));
  tool('reopen_manual_task', 'Reopens a manual task marked done by mistake.', { task: taskRef, projectId: projectRef, reason: z.string().optional() }, (a) =>
    work.reopen(task(a.task, a.projectId).id, a.reason),
  );
  tool('triage_task', 'Triages a task in the backlog (again).', { task: taskRef, projectId: projectRef }, (a) => {
    triage.request(task(a.task, a.projectId).id);
    return { requested: true };
  });
  tool('queue_task', 'Puts a backlog task in the queue without triage.', { task: taskRef, projectId: projectRef }, (a) => work.queue(task(a.task, a.projectId).id));
  tool('retry_task', 'Puts a failed task back in the queue.', { task: taskRef, projectId: projectRef }, (a) => work.retry(task(a.task, a.projectId).id));
  tool('move_task_to_front', 'Moves a queued task to the front of the queue.', { task: taskRef, projectId: projectRef }, (a) =>
    work.moveToFront(task(a.task, a.projectId).id),
  );
  tool(
    'add_dependency',
    'Makes a task wait: for another task or story to be merged (code), a manual task (manual), or a condition (external).',
    {
      task: taskRef,
      projectId: projectRef,
      kind: z.enum(['code', 'manual', 'external']),
      target: z.string().optional().describe('For code and manual: the task or story it waits for, by number or id.'),
      description: z.string().default(''),
      command: z.string().optional().describe('For external: a shell command that passes when the condition holds.'),
    },
    (a) => {
      const t = task(a.task, a.projectId);
      if (a.kind === 'external') return work.addDependency(t.id, { kind: 'external', target: null, description: a.description, command: a.command ?? null });
      if (!a.target) throw new AppError(400, 'TARGET_REQUIRED', 'Give the task or story to wait for');
      const number = /^#?(\d+)$/.exec(a.target);
      const target = number ? work.queries.byNumber(t.projectId, Number(number[1])) : work.queries.task(a.target) ? { type: 'task' as const, id: a.target } : { type: 'story' as const, id: a.target };
      if (!target) throw new AppError(404, 'TARGET_NOT_FOUND', `No task or story ${a.target}`);
      return work.addDependency(t.id, { kind: a.kind, target, description: a.description, command: null });
    },
  );
  tool('remove_dependency', 'Removes a dependency.', { dependencyId: z.string() }, ({ dependencyId }) => {
    work.removeDependency(dependencyId);
    return { removed: dependencyId };
  });
  tool('mark_dependency_met', 'Marks an external dependency as met.', { dependencyId: z.string() }, ({ dependencyId }) => work.markMet(dependencyId));
  tool('set_task_touches', "Sets a task's touch-set (repository paths or globs).", { task: taskRef, projectId: projectRef, touches: z.array(z.string()) }, (a) =>
    work.setTouches(task(a.task, a.projectId).id, a.touches),
  );
  tool('set_task_pipeline', "Sets a task's pipeline.", { task: taskRef, projectId: projectRef, pipelineId: z.string() }, (a) =>
    work.setPipeline(task(a.task, a.projectId).id, a.pipelineId),
  );

  // Runs, decisions, merges, queue

  tool(
    'start_run',
    'Starts a pipeline (default feature) or a single agent on a task now, outside the queue order.',
    { task: taskRef, projectId: projectRef, pipelineId: z.string().optional(), agentId: z.string().optional() },
    (a) => runs.start(task(a.task, a.projectId).id, a.agentId ? { agentId: a.agentId } : { pipelineId: a.pipelineId ?? 'feature' }),
  );
  tool('stop_run', 'Stops a run; its task fails and can be retried.', { runId: z.string() }, ({ runId }) => runs.stop(runId));
  tool(
    'override_decision',
    'Decides otherwise: picks another of a decision’s alternatives (approve a held plan, queue or merge held work, pass a failed gate).',
    { decisionId: z.string(), outcome: z.string(), rationale: z.string() },
    (a) => decisions.override(a.decisionId, a.outcome, a.rationale),
  );
  tool('merge_task', 'Sends a task waiting for review to the merge queue.', { task: taskRef, projectId: projectRef }, (a) => merges.enqueue(task(a.task, a.projectId).id));
  tool('set_queue_slots', 'Sets how many runs may work at once.', { slots: z.number().int().min(1).max(50) }, ({ slots }) => scheduler.setSlots(slots));
  tool('pause_queue', 'Pauses the queue: nothing new starts.', {}, () => scheduler.pause());
  tool('resume_queue', 'Resumes the queue.', {}, () => scheduler.resume());

  return server;
}
