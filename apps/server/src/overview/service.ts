import type { ActiveWork, NeedsYouKind, Overview, Period, Project, ProjectOverview } from '@megalodon/contracts';
import type { MergeService } from '../merge/service';
import type { NeedsYouService } from '../needsYou/service';
import type { ProjectsQueries } from '../projects/projection';
import type { RunsQueries } from '../runs/projection';
import type { WorkQueries } from '../work/projection';
import type { UsageQueries } from './usage';

const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

export interface OverviewDeps {
  projects: ProjectsQueries;
  work: WorkQueries;
  runs: RunsQueries;
  usage: UsageQueries;
  needsYou: NeedsYouService;
  merges: MergeService;
  now?: () => Date;
}

/** The supervisor's screen (PRD FR-2): what needs you, then every project at a glance. */
export class OverviewService {
  constructor(private readonly deps: OverviewDeps) {}

  view(period: Period): Overview {
    const now = this.deps.now?.() ?? new Date();
    const since = period === 'all' ? null : new Date(now.getTime() - PERIOD_MS[period]).toISOString();
    const needs = this.deps.needsYou.view();
    const blocks = new Map(needs.mergeBlocked.map((b) => [b.projectId, b.reason]));

    const projects = this.deps.projects
      .list()
      .map((project) => this.project(project, since, needs.items.filter((i) => i.task.projectId === project.id).length, blocks.get(project.id) ?? null))
      // where something happens or waits comes first
      .sort((a, b) => b.needsYou + b.active.length - (a.needsYou + a.active.length) || a.project.name.localeCompare(b.project.name));

    const byKind: Partial<Record<NeedsYouKind, number>> = {};
    for (const item of needs.items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;

    return {
      period,
      needsYou: { total: needs.items.length + needs.mergeBlocked.length, byKind },
      projects,
      totals: {
        costUsd: projects.reduce((sum, p) => sum + p.costUsd, 0),
        agentTimeMs: projects.reduce((sum, p) => sum + p.agentTimeMs, 0),
        merged: projects.reduce((sum, p) => sum + p.merged, 0),
        running: projects.reduce((sum, p) => sum + p.active.length, 0),
      },
    };
  }

  private project(project: Project, since: string | null, needsYou: number, mergeBlocked: string | null): ProjectOverview {
    const tasks = this.deps.work.tasks(project.id).filter((t) => t.kind === 'task');
    const counts: Record<string, number> = {};
    for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;

    const active: ActiveWork[] = [];
    for (const task of tasks) {
      if (task.status === 'running') {
        const run = this.deps.runs.forTask(task.id).find((r) => r.status === 'running') ?? null;
        const step = run ? this.deps.runs.steps(run.id).filter((s) => s.status === 'running').at(-1) : undefined;
        active.push({ task, runId: run?.id ?? null, step: step?.name ?? 'Starting', attempt: step?.attempt ?? null, since: step?.startedAt ?? task.statusChangedAt });
      } else if (task.status === 'merging') {
        active.push({ task, runId: null, step: mergeBlocked ? 'Merge waits for your checkout' : 'Merging', attempt: null, since: task.statusChangedAt });
      }
    }

    return {
      project,
      counts,
      done: counts.done ?? 0,
      total: tasks.filter((t) => t.status !== 'cancelled').length,
      active,
      needsYou,
      ...this.deps.usage.spent(project.id, since),
      merged: tasks.filter((t) => t.status === 'done' && (since === null || t.statusChangedAt >= since)).length,
      mergeBlocked,
    };
  }
}
