import type { NeedsYou, NeedsYouItem, Task } from '@megalodon/contracts';
import type { DecisionsQueries } from '../decisions/projection';
import type { MergeService } from '../merge/service';
import type { ProjectsQueries } from '../projects/projection';
import type { RunsQueries } from '../runs/projection';
import type { Scheduler } from '../scheduler/service';
import type { WorkQueries } from '../work/projection';

export interface NeedsYouDeps {
  work: WorkQueries;
  runs: RunsQueries;
  decisions: DecisionsQueries;
  projects: ProjectsQueries;
  merges: MergeService;
  scheduler: Scheduler;
}

/**
 * Everything waiting for the operator across projects (PRD FR-2), derived from the projections:
 * held plans and merges, failed work, manual tasks, and tasks triage could not queue.
 */
export class NeedsYouService {
  constructor(private readonly deps: NeedsYouDeps) {}

  view(): NeedsYou {
    const items: NeedsYouItem[] = [];
    for (const task of this.deps.work.inStatus(['needs_you', 'failed', 'todo', 'backlog'])) {
      const item = this.item(task);
      if (item) items.push(item);
    }
    items.sort((a, b) => a.since.localeCompare(b.since));
    return { items, mergeBlocked: this.deps.merges.blocks(), scheduler: this.deps.scheduler.state() };
  }

  count(): number {
    return this.view().items.length + this.deps.merges.blocks().length;
  }

  private item(task: Task): NeedsYouItem | null {
    const base = {
      task,
      projectName: this.deps.projects.get(task.projectId)?.name ?? '',
      reason: task.statusReason ?? '',
      runId: null as string | null,
      decisionId: null as string | null,
      mergeable: false,
      since: task.statusChangedAt,
    };
    if (task.kind === 'manual') return task.status === 'todo' ? { ...base, kind: 'manual', reason: task.description || 'Waiting for you.' } : null;

    const run = this.deps.runs.forTask(task.id)[0] ?? null;
    const runId = run?.id ?? null;
    const mergeable = !!run && run.commitSha !== null && (run.status === 'succeeded' || run.status === 'failed');
    if (task.status === 'needs_you') {
      if (run?.status === 'waiting') {
        return { ...base, kind: 'plan', runId, decisionId: this.held(run.id, 'plan') };
      }
      return { ...base, kind: 'review', runId, mergeable, decisionId: run ? this.held(run.id, 'merge') : null };
    }
    if (task.status === 'failed') return { ...base, kind: 'failed', runId };
    if (task.status === 'backlog') {
      if (task.triage === 'failed') return { ...base, kind: 'triage', reason: 'Triage failed; triage again or queue the task yourself.' };
      const queue = this.deps.decisions.effectiveForTask(task.id, 'queue');
      if (task.triage === 'done' && queue?.outcome === 'hold') return { ...base, kind: 'queue', reason: queue.rationale, decisionId: queue.id };
    }
    return null;
  }

  /** The decision to override to let a held run go on. */
  private held(runId: string, kind: string): string | null {
    const decision = this.deps.decisions.effective(runId, kind);
    return decision?.outcome === 'hold' ? decision.id : null;
  }
}
