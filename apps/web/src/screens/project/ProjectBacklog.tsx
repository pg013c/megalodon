import type { Story } from '@megalodon/contracts';
import { useState } from 'react';
import { useUpdateStory, useWork } from '../../data/work';
import { storyProgress, storyTasks } from '../../lib/stories';
import { useUiState } from '../../shell/UiState';
import { Button } from '../../ui/Button';
import { Empty } from '../../ui/Empty';
import { ErrorText, Input, TextArea } from '../../ui/Field';
import { Drawer } from '../../ui/Overlay';
import { StatusBadge } from '../../ui/StatusBadge';
import { useProject } from './ProjectLayout';
import { TaskDrawer } from './TaskDrawer';

export function ProjectBacklog() {
  const project = useProject();
  const work = useWork(project.id);
  const { setNewItemOpen } = useUiState();
  const [openStory, setOpenStory] = useState<string | null>(null);

  if (work.error) return <ErrorText error={work.error} />;
  if (!work.data) return null;
  const { stories } = work.data;

  if (stories.length === 0) {
    return (
      <Empty
        title="No stories yet"
        action={
          <Button variant="primary" onClick={() => setNewItemOpen(true)}>
            New
          </Button>
        }
      >
        A story is a piece of value that groups tasks; its status follows its tasks.
      </Empty>
    );
  }

  return (
    <div>
      <div className="flex items-center">
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setNewItemOpen(true)}>
            New
          </Button>
        </div>
      </div>
      <div className="mt-6">
        <StoryList stories={stories} onOpen={setOpenStory} />
      </div>
      <StoryDrawer projectId={project.id} id={openStory} onClose={() => setOpenStory(null)} />
    </div>
  );
}

/** The project's stories, in the server's order, with their status and progress. */
export function StoryList({ stories, onOpen }: { stories: Story[]; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {stories.map((story) => (
        <li key={story.id}>
          <button type="button" onClick={() => onOpen(story.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-canvas">
            <span className="w-10 shrink-0 text-xs text-muted">#{story.number}</span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{story.title}</span>
            <span className="w-24 shrink-0">
              <StatusBadge status={story.status} />
            </span>
            <Progress story={story} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Progress({ story }: { story: Story }) {
  return (
    <span className="flex shrink-0 items-center gap-2" title={`${story.doneCount} of ${story.taskCount} tasks done`}>
      <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-[#30d158]" style={{ width: `${storyProgress(story) * 100}%` }} />
      </span>
      <span className="w-10 font-mono text-xs text-muted">
        {story.doneCount}/{story.taskCount}
      </span>
    </span>
  );
}

function StoryDrawer({ projectId, id, onClose }: { projectId: string; id: string | null; onClose: () => void }) {
  const work = useWork(projectId);
  const [openTask, setOpenTask] = useState<string | null>(null);
  // Look the story up on every render, so the drawer follows the refreshed work query.
  const story = work.data?.stories.find((s) => s.id === id);
  const tasks = work.data && id ? storyTasks(work.data.tasks, id) : [];

  return (
    <Drawer
      open={id !== null}
      onOpenChange={(open) => {
        if (open) return;
        setOpenTask(null);
        onClose();
      }}
      title={story?.title ?? ''}
      description={story ? `#${story.number}` : undefined}
    >
      {story && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={story.status} />
            <Progress story={story} />
            <span className="text-xs text-muted">
              {story.doneCount} of {story.taskCount} tasks done
            </span>
          </div>
          <StoryEditor key={story.id} story={story} />
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Tasks</h3>
            {tasks.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">No tasks yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => setOpenTask(task.id)}
                      className="flex w-full items-center gap-4 px-4 py-2.5 text-left hover:bg-canvas"
                    >
                      <span className="w-10 shrink-0 text-xs text-muted">#{task.number}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
                      <StatusBadge status={task.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {/* Inside the story drawer, so Radix treats it as nested: closing it lands back on the story. */}
      <TaskDrawer id={openTask} onClose={() => setOpenTask(null)} />
    </Drawer>
  );
}

function StoryEditor({ story }: { story: Story }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(story.title);
  const [description, setDescription] = useState(story.description);
  const update = useUpdateStory(story.id);

  if (!editing) {
    return (
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Description</h3>
          <Button
            variant="ghost"
            onClick={() => {
              setTitle(story.title);
              setDescription(story.description);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6">
          {story.description || <span className="text-muted">No description.</span>}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label="Title" />
      <TextArea rows={8} value={description} onChange={(e) => setDescription(e.target.value)} className="font-sans" aria-label="Description" />
      <ErrorText error={update.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!title.trim() || update.isPending}
          onClick={() => update.mutate({ title, description }, { onSuccess: () => setEditing(false) })}
        >
          Save
        </Button>
      </div>
    </section>
  );
}
