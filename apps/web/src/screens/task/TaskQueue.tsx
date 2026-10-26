import type { Requirement, Task, TaskDetails } from '@megalodon/contracts';
import { useState } from 'react';
import { usePipelines } from '../../data/runs';
import { useAddDependency, useDependencyAction, useSetPipeline, useSetTouches, useTaskAction, useWork } from '../../data/work';
import { linesToList, listToLines } from '../../lib/format';
import { Button } from '../../ui/Button';
import { ErrorText, Input, TextArea } from '../../ui/Field';
import { requirementIcon } from '../../ui/Requirements';
import { Segmented } from '../../ui/Segmented';

/** How the task reaches the queue: triage, what it needs, what it touches, how it runs. */
export function TaskQueue({ details }: { details: TaskDetails }) {
  const { task } = details;
  if (task.kind !== 'task') return null;
  return (
    <div className="space-y-8">
      <QueueActions task={task} />
      {task.triageSummary && (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Triage</h3>
          <p className="mt-2 text-[13px] leading-5">{task.triageSummary}</p>
        </section>
      )}
      <Needs details={details} />
      <Touches task={task} />
      <PipelineChoice task={task} />
    </div>
  );
}

function QueueActions({ task }: { task: Task }) {
  const action = useTaskAction(task.id);
  const buttons = [
    { action: 'triage' as const, label: task.triage === 'failed' ? 'Triage again' : 'Triage', show: task.status === 'backlog' && task.triage !== 'pending' && task.triage !== 'running' },
    { action: 'queue' as const, label: 'Queue without triage', show: task.status === 'backlog' },
    { action: 'retry' as const, label: 'Back to the queue', show: task.status === 'failed' },
    { action: 'front' as const, label: 'Move to front', show: (task.status === 'ready' || task.status === 'blocked') && !task.front },
  ].filter((b) => b.show);
  const triaging = task.triage === 'pending' || task.triage === 'running';
  if (!buttons.length && !triaging && !task.front) return null;
  return (
    <section className="space-y-2">
      {triaging && <p className="text-[13px] text-muted">Triage is looking at this task…</p>}
      {task.front && <p className="text-[13px] text-muted">At the front of the queue.</p>}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b, i) => (
          <Button key={b.action} variant={i === 0 ? 'primary' : 'secondary'} disabled={action.isPending} onClick={() => action.mutate({ action: b.action })}>
            {b.label}
          </Button>
        ))}
      </div>
      <ErrorText error={action.error} />
    </section>
  );
}

function Needs({ details }: { details: TaskDetails }) {
  const { task, requirements, dependencies } = details;
  const act = useDependencyAction();
  const [adding, setAdding] = useState(false);
  const commandOf = new Map(dependencies.map((d) => [d.id, d.command]));
  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">What it needs</h3>
        {!adding && (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>
      {requirements.length === 0 && !adding && <p className="mt-2 text-[13px] text-muted">Nothing; it can start when a slot is free.</p>}
      <ul className="mt-2 space-y-1.5">
        {requirements.map((r, i) => (
          <RequirementRow
            key={r.dependencyId ?? `c${i}`}
            requirement={r}
            command={r.dependencyId ? (commandOf.get(r.dependencyId) ?? null) : null}
            onRemove={r.dependencyId ? () => act.mutate({ id: r.dependencyId!, action: 'remove' }) : null}
            onMet={r.kind === 'external' && !r.met ? () => act.mutate({ id: r.dependencyId!, action: 'met' }) : null}
          />
        ))}
      </ul>
      <ErrorText error={act.error} />
      {adding && <AddDependency task={task} onDone={() => setAdding(false)} />}
    </section>
  );
}

function RequirementRow({ requirement: r, command, onRemove, onMet }: { requirement: Requirement; command: string | null; onRemove: (() => void) | null; onMet: (() => void) | null }) {
  return (
    <li className="flex items-center gap-2 text-[13px]">
      <span className={`w-4 text-center ${r.met ? 'text-[#30d158]' : 'text-[#ff9f0a]'}`}>{r.met ? '✓' : requirementIcon[r.kind]}</span>
      <span className={`min-w-0 flex-1 truncate ${r.met ? 'text-muted line-through' : ''}`}>{r.label}</span>
      {command && <span className="truncate font-mono text-xs text-muted" title={command}>{command}</span>}
      {onMet && (
        <Button variant="ghost" onClick={onMet}>
          Met
        </Button>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} className="px-1 text-muted hover:text-ink" aria-label="Remove">
          ×
        </button>
      )}
    </li>
  );
}

function AddDependency({ task, onDone }: { task: Task; onDone: () => void }) {
  const work = useWork(task.projectId);
  const add = useAddDependency(task.id);
  const [kind, setKind] = useState<'code' | 'manual' | 'external'>('code');
  const [target, setTarget] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const others = work.data?.tasks.filter((t) => t.id !== task.id && t.status !== 'cancelled') ?? [];
  const options =
    kind === 'manual'
      ? others.filter((t) => t.kind === 'manual').map((t) => ({ value: `task:${t.id}`, label: `#${t.number} ${t.title}` }))
      : [
          ...(work.data?.stories.filter((s) => s.id !== task.storyId).map((s) => ({ value: `story:${s.id}`, label: `#${s.number} ${s.title} (story)` })) ?? []),
          ...others.filter((t) => t.kind === 'task').map((t) => ({ value: `task:${t.id}`, label: `#${t.number} ${t.title}` })),
        ];

  const submit = () => {
    const [type, id = ''] = target.split(':') as ['task' | 'story', string];
    const input =
      kind === 'external'
        ? { kind, description, command: command.trim() || null }
        : kind === 'manual'
          ? { kind, target: { type: 'task' as const, id } }
          : { kind, target: { type, id } };
    add.mutate(input, { onSuccess: onDone });
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line p-3">
      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k);
          setTarget('');
        }}
        options={[
          { value: 'code', label: 'Code' },
          { value: 'manual', label: 'Manual task' },
          { value: 'external', label: 'External' },
        ]}
      />
      {kind === 'external' ? (
        <>
          <Input placeholder="What must be true, e.g. the partner API is on staging" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Input placeholder="Optional check command, e.g. curl -sf https://…/health" value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono" />
        </>
      ) : (
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-accent"
        >
          <option value="">{kind === 'manual' ? 'Pick a manual task' : 'Pick a task or story that must be merged first'}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <ErrorText error={add.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={add.isPending || (kind === 'external' ? !description.trim() : !target)} onClick={submit}>
          Add
        </Button>
      </div>
    </div>
  );
}

function Touches({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const save = useSetTouches(task.id);
  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Touches</h3>
        {!editing && (
          <Button
            variant="ghost"
            onClick={() => {
              setText(listToLines(task.touches));
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="src/payments/**" spellCheck={false} />
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(linesToList(text), { onSuccess: () => setEditing(false) })}>
              Save
            </Button>
          </div>
        </div>
      ) : task.touches.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.touches.map((t) => (
            <span key={t} className="rounded-full bg-canvas px-2 py-0.5 font-mono text-xs text-muted">
              {t}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-muted">Unknown until triage; it may run next to anything.</p>
      )}
    </section>
  );
}

function PipelineChoice({ task }: { task: Task }) {
  const pipelines = usePipelines();
  const set = useSetPipeline(task.id);
  return (
    <section className="flex items-center justify-between gap-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Pipeline</h3>
      <select
        value={task.pipelineId}
        onChange={(e) => set.mutate(e.target.value)}
        className="h-8 rounded-full border border-line bg-surface px-3 text-[13px] outline-none"
      >
        {pipelines.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </section>
  );
}
