import type { Story, Task } from '@megalodon/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTaskDetails, useWork } from '../../data/work';
import { columnOf, columns, coreColumns, statusLabel, type Column } from '../../lib/status';
import { taskPath } from '../../shell/screens';
import { useUiState } from '../../shell/UiState';
import { Button } from '../../ui/Button';
import { Empty } from '../../ui/Empty';
import { ErrorText } from '../../ui/Field';
import { Drawer } from '../../ui/Overlay';
import { StatusDot } from '../../ui/StatusBadge';
import { TaskDetailsView } from '../task/TaskDetailsView';
import { useProject } from './ProjectLayout';

export function ProjectBoard() {
  const project = useProject();
  const work = useWork(project.id);
  const { setNewItemOpen } = useUiState();
  const [storyFilter, setStoryFilter] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);

  if (work.error) return <ErrorText error={work.error} />;
  if (!work.data) return null;
  const { stories, tasks } = work.data;

  if (stories.length === 0 && tasks.length === 0) {
    return (
      <Empty
        title="Nothing here yet"
        action={
          <Button variant="primary" onClick={() => setNewItemOpen(true)}>
            Add the first task
          </Button>
        }
      >
        Add tasks for agents, manual tasks for yourself, and stories to group them.
      </Empty>
    );
  }

  const storiesById = new Map(stories.map((s) => [s.id, s]));
  const visible = tasks.filter((t) => storyFilter === null || t.storyId === storyFilter);
  const byColumn = new Map<Column, Task[]>();
  for (const task of visible) {
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
        <StoryStrip stories={stories} selected={storyFilter} onSelect={setStoryFilter} />
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
              onOpen={setOpenTask}
            />
          ))}
        </div>
      </div>

      <TaskDrawer id={openTask} onClose={() => setOpenTask(null)} />
    </div>
  );
}

function StoryStrip({ stories, selected, onSelect }: { stories: Story[]; selected: string | null; onSelect: (id: string | null) => void }) {
  if (stories.length === 0) return null;
  const chip = (active: boolean) =>
    `flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] ${
      active ? 'border-ink bg-ink text-surface' : 'border-line bg-surface hover:bg-canvas'
    }`;
  return (
    <div className="flex max-w-full gap-2 overflow-x-auto">
      <button type="button" className={chip(selected === null)} onClick={() => onSelect(null)}>
        All
      </button>
      {stories.map((story) => (
        <button
          key={story.id}
          type="button"
          className={chip(selected === story.id)}
          onClick={() => onSelect(selected === story.id ? null : story.id)}
          title={statusLabel[story.status]}
        >
          <StatusDot status={story.status} />
          {story.title}
          <span className="text-xs opacity-60">
            {story.doneCount}/{story.taskCount}
          </span>
        </button>
      ))}
    </div>
  );
}

function BoardColumn({
  column,
  tasks,
  stories,
  onOpen,
}: {
  column: Column;
  tasks: Task[];
  stories: Map<string, Story>;
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
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function TaskDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const details = useTaskDetails(id);
  const task = details.data?.task;
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      title={task ? task.title : ''}
      description={task ? `#${task.number}` : undefined}
    >
      <ErrorText error={details.error} />
      {details.data && (
        <>
          <TaskDetailsView details={details.data} />
          <Link to={taskPath(details.data.task.id)} className="mt-8 inline-block text-[13px] text-accent">
            Open task page →
          </Link>
        </>
      )}
    </Drawer>
  );
}
