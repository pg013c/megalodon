import type { Agent, Pipeline } from '@megalodon/contracts';
import { useState } from 'react';
import { useAgents, usePipelines } from '../../data/runs';
import { ErrorText } from '../../ui/Field';
import { Drawer } from '../../ui/Overlay';

/** The agents Megalodon can run. Pipelines and evaluations join them in later steps. */
export function LibraryScreen() {
  const agents = useAgents();
  const pipelines = usePipelines();
  const [open, setOpen] = useState<Agent | null>(null);
  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">Agents & Pipelines</h1>
      <p className="mt-2 max-w-xl text-[15px] text-muted">
        Agents are Markdown files: built-in ones ship with Megalodon, your own live in the library folder of the data directory and win on
        the same name.
      </p>
      <ErrorText error={agents.error ?? pipelines.error} />
      <h2 className="mt-10 text-xs font-medium uppercase tracking-wide text-muted">Pipelines</h2>
      <div className="mt-3 space-y-3">
        {pipelines.data?.map((pipeline) => (
          <PipelineCard key={pipeline.id} pipeline={pipeline} />
        ))}
      </div>
      <h2 className="mt-10 text-xs font-medium uppercase tracking-wide text-muted">Agents</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.data?.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => setOpen(agent)}
            className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-left transition hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold">{agent.name}</span>
              <span className="text-xs text-muted">{agent.source === 'builtin' ? 'Built-in' : 'Yours'}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] text-muted">{agent.description}</p>
            <p className="mt-4 font-mono text-xs text-muted">
              {agent.model}
              {agent.effort ? ` · ${agent.effort}` : ''} · v{agent.version.slice(0, 7)}
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {agent.tools.map((tool) => (
                <span key={tool} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">
                  {tool}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <Drawer open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={open?.name ?? ''} description={open ? `${open.id}.md` : undefined}>
        <pre className="whitespace-pre-wrap font-sans text-[14px] leading-6">{open?.instructions}</pre>
      </Drawer>
    </section>
  );
}

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">{pipeline.name}</span>
        <span className="font-mono text-xs text-muted">
          {pipeline.id}.yaml · v{pipeline.version.slice(0, 7)}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted">{pipeline.description}</p>
      <ol className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
        {pipeline.steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted">→</span>}
            <span className="rounded-full border border-line px-3 py-1">
              {step.name ?? ('agent' in step ? step.agent : 'Checks')}
              {'gate' in step && step.gate && <span className="ml-2 text-xs text-muted">gate ≥ {step.gate.minScore}</span>}
              {step.onFail && (
                <span className="ml-2 text-xs text-muted">
                  ↺ {step.onFail.retry} ×{step.onFail.max === 'project' ? 'fix passes' : step.onFail.max}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
