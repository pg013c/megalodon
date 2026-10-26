import type { QueueEntry } from '@megalodon/contracts';
import { Link } from 'react-router';
import { useQueue, useQueueControl } from '../data/queue';
import { timeAgo } from '../lib/format';
import { taskPath } from '../shell/screens';
import { Button } from '../ui/Button';
import { ErrorText } from '../ui/Field';
import { StatusDot } from '../ui/StatusBadge';

/** The global queue: how many run at once, what runs now, what waits and why (ADR-0007). */
export function QueuePanel() {
  const queue = useQueue();
  const control = useQueueControl();
  if (!queue.data) return <ErrorText error={queue.error} />;
  const { state, running, waiting } = queue.data;

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-[15px] font-semibold">Queue</h2>
        <span className="text-[13px] text-muted">
          {running.length} of {state.slots} running · {waiting.length} waiting
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted">Slots</span>
          <Button variant="secondary" className="w-8 px-0" disabled={state.slots <= 1} onClick={() => control.mutate({ type: 'slots', slots: state.slots - 1 })}>
            −
          </Button>
          <span className="w-5 text-center text-[13px]">{state.slots}</span>
          <Button variant="secondary" className="w-8 px-0" onClick={() => control.mutate({ type: 'slots', slots: state.slots + 1 })}>
            +
          </Button>
          {state.paused ? (
            <Button variant="primary" onClick={() => control.mutate({ type: 'resume' })}>
              Resume
            </Button>
          ) : (
            <Button onClick={() => control.mutate({ type: 'pause' })}>Pause</Button>
          )}
        </div>
      </div>
      {state.paused && (
        <p className="mt-3 rounded-lg bg-[#ff9f0a]/10 px-3 py-2 text-[13px] text-[#c76e00]">
          {state.paused === 'plan_limit'
            ? `Paused: the plan's usage limit was reached. Resumes ${state.pausedUntil ? timeAgo(state.pausedUntil) : 'later'}.`
            : 'Paused by you. Nothing new starts.'}
        </p>
      )}
      <ErrorText error={control.error} />
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <QueueList title="Running" entries={running} empty="Nothing runs right now." />
        <QueueList title="Waiting" entries={waiting} empty="The queue is empty." />
      </div>
    </section>
  );
}

function QueueList({ title, entries, empty }: { title: string; entries: QueueEntry[]; empty: string }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {entries.length === 0 && <p className="mt-2 text-[13px] text-muted">{empty}</p>}
      <ol className="mt-2 space-y-1">
        {entries.map(({ task, projectName, runId, waitingFor }) => (
          <li key={task.id}>
            <Link to={runId ? `/runs/${runId}` : taskPath(task.id)} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-canvas">
              <span className="mt-1.5">
                <StatusDot status={task.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <span className="text-muted">#{task.number}</span> {task.title}
                  {task.front && <span className="ml-1 text-xs text-accent">first</span>}
                </span>
                <span className="block truncate text-xs text-muted">
                  {projectName}
                  {waitingFor.length > 0 && ` · waits for ${waitingFor.map((r) => r.label).join(', ')}`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
