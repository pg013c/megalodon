import type { Task } from '@megalodon/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAgents, usePipelines, useStartRun, useTaskRuns } from '../../data/runs';
import { cost, duration, timeAgo } from '../../lib/format';
import { Button } from '../../ui/Button';
import { ErrorText } from '../../ui/Field';
import { StatusBadge } from '../../ui/StatusBadge';

const STARTABLE = new Set(['backlog', 'ready', 'failed', 'needs_you']);

/** A task's runs, and starting a new one. Until the scheduler exists, you start runs yourself. */
export function TaskRuns({ task }: { task: Task }) {
  const runs = useTaskRuns(task.id);
  const pipelines = usePipelines();
  const agents = useAgents();
  const start = useStartRun(task.id);
  const [choice, setChoice] = useState('pipeline:feature');

  if (task.kind !== 'task') return null;
  const running = runs.data?.some((r) => r.status === 'running') ?? false;
  const canStart = STARTABLE.has(task.status) && !running;
  const [kind, id = ''] = choice.split(':');

  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Runs</h3>
      {canStart && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="What to run"
            className="h-8 rounded-full border border-line bg-surface px-3 text-[13px] outline-none"
          >
            <optgroup label="Pipelines">
              {pipelines.data?.map((p) => (
                <option key={p.id} value={`pipeline:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="One agent">
              {agents.data?.map((a) => (
                <option key={a.id} value={`agent:${a.id}`}>
                  {a.name} only
                </option>
              ))}
            </optgroup>
          </select>
          <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate(kind === 'agent' ? { agentId: id } : { pipelineId: id })}>
            {start.isPending ? 'Starting…' : runs.data?.length ? 'Run again' : 'Run'}
          </Button>
        </div>
      )}
      <ErrorText error={start.error ?? runs.error} />
      <ul className="mt-3 space-y-2">
        {runs.data?.map((run) => (
          <li key={run.id}>
            <Link to={`/runs/${run.id}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[13px] hover:bg-canvas">
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
