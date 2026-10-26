import { canTransition, type HistoryEntry, type Task, type TaskDetails } from '@megalodon/contracts';
import { useState } from 'react';
import { useTaskAction, useUpdateTask, useWork, type TaskAction } from '../../data/work';
import { timeAgo } from '../../lib/format';
import { statusLabel } from '../../lib/status';
import { Button } from '../../ui/Button';
import { ErrorText, Input, TextArea } from '../../ui/Field';
import { StatusBadge } from '../../ui/StatusBadge';
import { TaskQueue } from './TaskQueue';
import { TaskRuns } from './TaskRuns';

/** One task: what it is, where it stands, what you can do, and what happened to it. */
export function TaskDetailsView({ details }: { details: TaskDetails }) {
  const { task, story } = details;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={task.status} />
        <span className="text-xs text-muted">{task.kind === 'manual' ? 'Manual task' : 'Task'}</span>
        {story && <span className="text-xs text-muted">in #{story.number} {story.title}</span>}
      </div>
      {task.statusReason && <p className="rounded-lg bg-canvas px-3 py-2 text-[13px] text-muted">{task.statusReason}</p>}
      <Actions task={task} />
      <TaskQueue details={details} />
      <TaskRuns task={task} />
      <Editor task={task} />
      <History entries={details.history} />
    </div>
  );
}

function Actions({ task }: { task: Task }) {
  const action = useTaskAction(task.id);
  const allowed = (to: string) => canTransition(task.kind, task.status, to);
  const run = (a: TaskAction) => action.mutate({ action: a });

  const buttons: { action: TaskAction; label: string; show: boolean; variant: 'primary' | 'secondary' }[] = [
    { action: 'complete', label: 'Mark done', show: task.kind === 'manual' && allowed('done'), variant: 'primary' },
    { action: 'reopen', label: 'Reopen', show: task.kind === 'manual' && allowed('todo'), variant: 'secondary' },
    { action: 'cancel', label: 'Cancel task', show: allowed('cancelled'), variant: 'secondary' },
  ];
  const visible = buttons.filter((b) => b.show);
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {visible.map((b) => (
          <Button key={b.action} variant={b.variant} disabled={action.isPending} onClick={() => run(b.action)}>
            {b.label}
          </Button>
        ))}
      </div>
      <ErrorText error={action.error} />
    </div>
  );
}

function Editor({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [storyId, setStoryId] = useState(task.storyId ?? '');
  const update = useUpdateTask(task.id);
  const work = useWork(task.projectId);

  if (!editing) {
    return (
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Description</h3>
          <Button
            variant="ghost"
            onClick={() => {
              setTitle(task.title);
              setDescription(task.description);
              setStoryId(task.storyId ?? '');
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6">
          {task.description || <span className="text-muted">No description.</span>}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <TextArea rows={8} value={description} onChange={(e) => setDescription(e.target.value)} className="font-sans" aria-label="Description" />
      <select
        value={storyId}
        onChange={(e) => setStoryId(e.target.value)}
        aria-label="Story"
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-accent"
      >
        <option value="">No story</option>
        {work.data?.stories.map((s) => (
          <option key={s.id} value={s.id}>
            #{s.number} {s.title}
          </option>
        ))}
      </select>
      <ErrorText error={update.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!title.trim() || update.isPending}
          onClick={() =>
            update.mutate({ title, description, storyId: storyId || null }, { onSuccess: () => setEditing(false) })
          }
        >
          Save
        </Button>
      </div>
    </section>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">History</h3>
      <ol className="mt-3 space-y-3 border-l border-line pl-4">
        {[...entries].reverse().map((entry) => (
          <li key={entry.seq} className="text-[13px]">
            <p>{describe(entry)}</p>
            <p className="text-xs text-muted">
              {actorName(entry)} · {timeAgo(entry.at)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function describe(entry: HistoryEntry): string {
  const data = (entry.data ?? {}) as { to?: string; reason?: string | null; title?: string };
  switch (entry.type) {
    case 'task.created':
      return 'Created';
    case 'task.updated':
      return 'Edited';
    case 'task.status_changed':
      return `${statusLabel[data.to ?? ''] ?? data.to}${data.reason ? ` — ${data.reason}` : ''}`;
    case 'task.touches_set':
      return 'Touch-set changed';
    case 'task.pipeline_set':
      return 'Pipeline chosen';
    case 'task.moved_to_front':
      return 'Moved to the front of the queue';
    case 'triage.requested':
      return 'Triage requested';
    case 'triage.started':
      return 'Triage started';
    case 'triage.completed':
      return 'Triaged';
    case 'triage.failed':
      return `Triage failed${(entry.data as { error?: string }).error ? ` — ${(entry.data as { error?: string }).error}` : ''}`;
    case 'dependency.added':
      return 'Dependency added';
    case 'dependency.removed':
      return 'Dependency removed';
    case 'dependency.met':
      return 'External dependency met';
    case 'decision.made':
      return 'Decision recorded';
    default:
      return entry.type;
  }
}

function actorName({ actor }: HistoryEntry): string {
  switch (actor.kind) {
    case 'operator':
      return 'You';
    case 'agent':
      return `Agent ${actor.agentId}`;
    case 'policy':
      return `Policy ${actor.policy}`;
    case 'system':
      return 'Megalodon';
  }
}
