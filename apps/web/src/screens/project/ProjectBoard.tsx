import type { Requirement, Story, Task } from '@megalodon/contracts';
import { useState } from 'react';
import { useWork } from '../../data/work';
import { columnOf, columns, coreColumns, statusLabel, type Column } from '../../lib/status';
import { useUiState } from '../../shell/UiState';
import { Button } from '../../ui/Button';
import { Empty } from '../../ui/Empty';
import { ErrorText } from '../../ui/Field';
import { WaitingFor } from '../../ui/Requirements';
import { useProject } from './ProjectLayout';
import { TaskDrawer } from './TaskDrawer';

export function ProjectBoard() {
  const project = useProject();
  const work = useWork(project.id);
  const { setNewItemOpen } = useUiState();
  const [showCancelled, setShowCancelled] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);

  if (work.error) return <ErrorText error={work.error} />;
  if (!work.data) return null;
  const { stories, tasks, requirements } = work.data;

  if (tasks.length === 0) {
    return (
      <Empty
        title="Nothing here yet"
        action={
          <Button variant="primary" onClick={() => setNewItemOpen(true)}>
            Add the first task
          </Button>
        }
      >
        Add tasks for agents and manual tasks for yourself. Stories that group them live in the Backlog.
      </Empty>
    );
  }

  const storiesById = new Map(stories.map((s) => [s.id, s]));
  const byColumn = new Map<Column, Task[]>();
  for (const task of tasks) {
    const column = columnOf(task);
    byColumn.set(column, [...(byColumn.get(column) ?? []), task]);
  }
  const shown = columns.filter(
    (c) => coreColumns.includes(c) || (c === 'cancelled' ? showCancelled : (byColumn.get(c)?.length ?? 0) > 0),
  );
  const cancelledCount = byColumn.get('cancelled')?.length ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto flex items-center gap-3">
          {cancelledCount > 0 && (
            <Button variant="ghost" onClick={() => setShowCancelled((v) => !v)}>
              {showCancelled ? 'Hide' : 'Show'} cancelled ({cancelledCount})
            </Button>
          )}
          <Button variant="primary" onClick={() => setNewItemOpen(true)}>
            New
          </Button>
        </div>
      </div>

      <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-4">
        <div className="flex gap-3">
          {shown.map((column) => (
            <BoardColumn
              key={column}
              column={column}
              tasks={byColumn.get(column) ?? []}
              stories={storiesById}
              requirements={requirements}
              onOpen={setOpenTask}
            />
          ))}
        </div>
      </div>

      <TaskDrawer id={openTask} onClose={() => setOpenTask(null)} />
    </div>
  );
}

function BoardColumn({
  column,
  tasks,
  stories,
  requirements,
  onOpen,
}: {
  column: Column;
  tasks: Task[];
  stories: Map<string, Story>;
  requirements: Record<string, Requirement[]>;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="w-64 shrink-0">
      <h2 className="flex items-center justify-between px-1 pb-2 text-xs font-medium text-muted">
        {statusLabel[column]}
        <span>{tasks.length || ''}</span>
      </h2>
      <div className="min-h-24 space-y-2 rounded-[var(--radius-card)] bg-line/30 p-2">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpen(task.id)}
            className="block w-full rounded-xl border border-line bg-surface p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:shadow-md"
          >
            <p className="text-[13px] leading-5">{task.title}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span>#{task.number}</span>
              {task.kind === 'manual' && <span className="rounded bg-[#ff375f]/10 px-1.5 text-[#ff375f]">You</span>}
              {task.storyId && <span className="truncate">{stories.get(task.storyId)?.title}</span>}
              {task.front && <span className="text-accent">first</span>}
              {(task.triage === 'pending' || task.triage === 'running') && <span>triaging…</span>}
              {task.triage === 'failed' && task.status === 'backlog' && <span className="text-[#ff375f]">triage failed</span>}
            </div>
            {['backlog', 'blocked', 'ready'].includes(task.status) && <WaitingFor requirements={requirements[task.id] ?? []} />}
          </button>
        ))}
      </div>
    </section>
  );
}
