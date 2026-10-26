import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useBranches, useDisconnectProject, useUpdateSettings } from '../../data/projects';
import { Button } from '../../ui/Button';
import { ErrorText, Field, Input, TextArea } from '../../ui/Field';
import { Modal } from '../../ui/Overlay';
import { useProject } from './ProjectLayout';
import { fromForm, toForm, type SettingsForm } from './settingsForm';

export function ProjectSettingsScreen() {
  const project = useProject();
  const branches = useBranches(project.id);
  const save = useUpdateSettings(project.id);
  const [form, setForm] = useState<SettingsForm>(() => toForm(project.settings));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(project.settings));

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    save.reset();
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setCheck = (i: number, patch: Partial<SettingsForm['checks'][number]>) =>
    set('checks', form.checks.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(fromForm(form, project.settings.packageManager), { onSuccess: (p) => setForm(toForm(p.settings)) });
  };

  const localBranches = branches.data?.filter((b) => b.kind === 'local').map((b) => b.name) ?? [form.baseBranch];

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-10">
      <Section title="Branches" description="Tasks start from the base branch and merge back into it.">
        <Field label="Base branch">
          <select
            value={form.baseBranch}
            onChange={(e) => set('baseBranch', e.target.value)}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px] outline-none focus:border-accent"
          >
            {localBranches.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section
        title="Worktree setup"
        description={`Commands run in every new worktree before agents start.${
          project.settings.packageManager ? ` Detected package manager: ${project.settings.packageManager}.` : ''
        }`}
      >
        <Field label="Setup commands" hint="One per line, run in order.">
          <TextArea value={form.setup} onChange={(e) => set('setup', e.target.value)} spellCheck={false} />
        </Field>
      </Section>

      <Section title="Checks" description="Megalodon runs these itself; their results, not an agent's word, decide a merge.">
        <div className="space-y-2">
          {form.checks.map((check, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 sm:flex-nowrap">
              <Input aria-label="Name" value={check.name} onChange={(e) => setCheck(i, { name: e.target.value })} placeholder="name" className="sm:w-28" />
              <Input
                aria-label="Command"
                value={check.command}
                onChange={(e) => setCheck(i, { command: e.target.value })}
                placeholder="command"
                className="font-mono"
                spellCheck={false}
              />
              <Input
                aria-label="Timeout in seconds"
                value={check.timeoutSec}
                onChange={(e) => setCheck(i, { timeoutSec: e.target.value })}
                inputMode="numeric"
                className="sm:w-20"
                title="Timeout (s)"
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
                <input type="checkbox" checked={check.required} onChange={(e) => setCheck(i, { required: e.target.checked })} />
                Required
              </label>
              <Button variant="ghost" onClick={() => set('checks', form.checks.filter((_, j) => j !== i))} aria-label="Remove check">
                ×
              </Button>
            </div>
          ))}
          <Button onClick={() => set('checks', [...form.checks, { name: '', command: '', required: true, timeoutSec: '900' }])}>Add check</Button>
        </div>
        <Field label="Fix passes" hint="How many times an agent may try to fix failing checks (0–5).">
          <Input value={form.maxFixPasses} onChange={(e) => set('maxFixPasses', e.target.value)} inputMode="numeric" className="w-20" />
        </Field>
      </Section>

      <Section title="Parallel runs" description="How many of this project's tasks may run at once. Empty: only the global limit applies.">
        <Field label="Limit">
          <Input value={form.maxParallel} onChange={(e) => set('maxParallel', e.target.value)} inputMode="numeric" className="w-20" placeholder="—" />
        </Field>
      </Section>

      <Section title="Sensitive areas" description="Changes here never merge without you.">
        <Field label="Paths" hint="Glob patterns, one per line, e.g. src/payments/**">
          <TextArea value={form.sensitivePaths} onChange={(e) => set('sensitivePaths', e.target.value)} spellCheck={false} />
        </Field>
      </Section>

      <Section title="Knowledge base" description="PRD, ADRs and decisions agents read and update.">
        <div className="inline-flex rounded-full bg-line/60 p-0.5">
          {(['repo', 'external'] as const).map((location) => (
            <button
              key={location}
              type="button"
              onClick={() => set('knowledgeLocation', location)}
              className={`rounded-full px-4 py-1 text-[13px] ${form.knowledgeLocation === location ? 'bg-surface font-medium shadow-sm' : 'text-muted'}`}
            >
              {location === 'repo' ? 'In the repository' : 'Outside the repository'}
            </button>
          ))}
        </div>
        {form.knowledgeLocation === 'repo' && (
          <Field label="Folder" hint="Relative to the repository root.">
            <Input value={form.knowledgePath} onChange={(e) => set('knowledgePath', e.target.value)} className="w-60 font-mono" />
          </Field>
        )}
      </Section>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-canvas/80 px-4 py-3 backdrop-blur">
        <ErrorText error={save.error} />
        {save.isSuccess && !dirty && <span className="text-[13px] text-muted">Saved</span>}
        <Button variant="ghost" disabled={!dirty} onClick={() => setForm(toForm(project.settings))}>
          Discard
        </Button>
        <Button variant="primary" type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <DangerZone projectId={project.id} name={project.name} />
    </form>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[13px] text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function DangerZone({ projectId, name }: { projectId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const disconnect = useDisconnectProject();
  const navigate = useNavigate();

  return (
    <section className="rounded-[var(--radius-card)] border border-line p-5">
      <h2 className="text-[15px] font-semibold">Disconnect project</h2>
      <p className="mt-0.5 text-[13px] text-muted">Megalodon forgets the project. The repository on disk is not touched.</p>
      <Button variant="secondary" className="mt-4" onClick={() => setOpen(true)}>
        Disconnect…
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`Disconnect ${name}?`} description="You can connect it again at any time.">
        <ErrorText error={disconnect.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate(projectId, { onSuccess: () => navigate('/') })}
          >
            Disconnect
          </Button>
        </div>
      </Modal>
    </section>
  );
}
