import type { TaskKind } from '@megalodon/contracts';
import { useState, type FormEvent } from 'react';
import { useActiveProject } from '../data/projects';
import { useCreateStory, useCreateTask, useWork } from '../data/work';
import { Button } from '../ui/Button';
import { ErrorText, Field, Input, TextArea } from '../ui/Field';
import { Modal } from '../ui/Overlay';
import { Segmented } from '../ui/Segmented';
import { useUiState } from './UiState';

type Kind = TaskKind | 'story';

const kinds = [
  { value: 'task', label: 'Task' },
  { value: 'manual', label: 'Manual task' },
  { value: 'story', label: 'Story' },
] as const;

const hints: Record<Kind, string> = {
  task: 'Work an agent pipeline can finish and merge.',
  manual: 'Work only you can do, like creating an API key or configuring a service.',
  story: 'A piece of value that groups tasks. Its status follows its tasks.',
};

/** Adds a story, task or manual task to the active project. */
export function NewItemDialog() {
  const { newItemOpen, setNewItemOpen } = useUiState();
  const project = useActiveProject();
  if (!project) return null;
  return <NewItemForm key={String(newItemOpen)} projectId={project.id} open={newItemOpen} onOpenChange={setNewItemOpen} />;
}

function NewItemForm({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [kind, setKind] = useState<Kind>('task');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [storyId, setStoryId] = useState<string>('');
  const work = useWork(projectId);
  const createTask = useCreateTask(projectId);
  const createStory = useCreateStory(projectId);
  const pending = createTask.isPending || createStory.isPending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === 'story') await createStory.mutateAsync({ title, description });
    else await createTask.mutateAsync({ kind, storyId: storyId || null, title, description });
    onOpenChange(false);
  };

  const openStories = work.data?.stories.filter((s) => s.status !== 'done' && s.status !== 'cancelled') ?? [];

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New" description={hints[kind]}>
      <form onSubmit={(e) => void submit(e).catch(() => {})} className="space-y-4">
        <Segmented value={kind} options={kinds} onChange={setKind} />
        <Field label="Title">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Description" hint={kind === 'task' ? 'What to change and how you will know it is done.' : undefined}>
          <TextArea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} className="font-sans" />
        </Field>
        {kind !== 'story' && openStories.length > 0 && (
          <Field label="Story">
            <select
              value={storyId}
              onChange={(e) => setStoryId(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-accent"
            >
              <option value="">No story</option>
              {openStories.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.number} {s.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorText error={createTask.error ?? createStory.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!title.trim() || pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
