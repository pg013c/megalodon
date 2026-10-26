import type { Task } from '@megalodon/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAgents, useStartRun, useTaskRuns } from '../../data/runs';
import { cost, duration, timeAgo } from '../../lib/format';
import { Button } from '../../ui/Button';
import { ErrorText } from '../../ui/Field';
import { StatusBadge } from '../../ui/StatusBadge';

const STARTABLE = new Set(['backlog', 'ready', 'failed', 'needs_you']);

/** A task's runs, and starting a new one. Until the scheduler exists, you start runs yourself. */
export function TaskRuns({ task }: { task: Task }) {
  const runs = useTaskRuns(task.id);
  const agents = useAgents();
  const start = useStartRun(task.id);
  const [agentId, setAgentId] = useState('implementer');

  if (task.kind !== 'task') return null;
  const running = runs.data?.some((r) => r.status === 'running') ?? false;
  const canStart = STARTABLE.has(task.status) && !running;

  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Runs</h3>
      {canStart && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(agents.data?.length ?? 0) > 1 && (
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              aria-label="Agent"
              className="h-8 rounded-full border border-line bg-surface px-3 text-[13px] outline-none"
            >
              {agents.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate(agentId)}>
            {start.isPending ? 'Starting…' : runs.data?.length ? 'Run again' : 'Run agent'}
          </Button>
        </div>
      )}
      <ErrorText error={start.error ?? runs.error} />
      <ul className="mt-3 space-y-2">
        {runs.data?.map((run) => (
          <li key={run.id}>
            <Link
              to={`/runs/${run.id}`}
              className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[13px] hover:bg-canvas"
            >
              <StatusBadge status={run.status} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{run.branch}</span>
              <span className="text-xs text-muted">
                {run.status === 'running' ? `started ${timeAgo(run.startedAt)}` : `${duration(run.durationMs)} · ${cost(run.usage.costUsd)}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
