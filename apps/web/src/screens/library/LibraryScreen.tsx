import type { Agent } from '@megalodon/contracts';
import { useState } from 'react';
import { useAgents } from '../../data/runs';
import { ErrorText } from '../../ui/Field';
import { Drawer } from '../../ui/Overlay';

/** The agents Megalodon can run. Pipelines and evaluations join them in later steps. */
export function LibraryScreen() {
  const agents = useAgents();
  const [open, setOpen] = useState<Agent | null>(null);
  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">Agents & Pipelines</h1>
      <p className="mt-2 max-w-xl text-[15px] text-muted">
        Agents are Markdown files: built-in ones ship with Megalodon, your own live in the library folder of the data directory and win on
        the same name.
      </p>
      <ErrorText error={agents.error} />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
