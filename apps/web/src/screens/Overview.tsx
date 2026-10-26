import type { NeedsYouKind, Period, ProjectOverview } from '@megalodon/contracts';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOverview } from '../data/overview';
import { useActiveProject, useProjects, useSetActiveProject } from '../data/projects';
import { cost, duration, timeAgo } from '../lib/format';
import { statusLabel } from '../lib/status';
import { useUiState } from '../shell/UiState';
import { Button } from '../ui/Button';
import { Empty } from '../ui/Empty';
import { ErrorText } from '../ui/Field';
import { Segmented } from '../ui/Segmented';
import { StatusDot } from '../ui/StatusBadge';
import { QueuePanel } from './QueuePanel';

const periods = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All' },
] as const;

const needsLabel: Record<NeedsYouKind, string> = {
  plan: 'plans to approve',
  review: 'to review',
  failed: 'failed',
  manual: 'for you to do',
  queue: 'waiting to be queued',
  triage: 'triage failed',
};

/** The supervisor's screen: what needs you, the queue, then every project at a glance. */
export function Overview() {
  const projects = useProjects();
  const [period, setPeriod] = useState<Period>('7d');
  const overview = useOverview(period);
  const { setConnectOpen } = useUiState();

  if (projects.data?.length === 0) {
    return (
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        <div className="mt-8">
          <Empty
            title="No projects yet"
            action={
              <Button variant="primary" onClick={() => setConnectOpen(true)}>
                Connect a project
              </Button>
            }
          >
            Connect a local git repository to start working on it with agents.
          </Empty>
        </div>
      </section>
    );
  }

  const data = overview.data;
  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
          {data && (
            <p className="mt-1 text-[13px] text-muted">
              {data.totals.running} running · {data.totals.merged} merged · {cost(data.totals.costUsd)} · {duration(data.totals.agentTimeMs)} of agent time
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Segmented value={period} options={periods} onChange={setPeriod} />
          <Button onClick={() => setConnectOpen(true)}>Connect project</Button>
        </div>
      </div>
      <ErrorText error={overview.error} />

      {data && <NeedsYouStrip total={data.needsYou.total} byKind={data.needsYou.byKind} />}
      <QueuePanel />

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.projects.map((p) => (
          <ProjectCard key={p.project.id} overview={p} />
        ))}
      </div>
    </section>
  );
}

function NeedsYouStrip({ total, byKind }: { total: number; byKind: Partial<Record<NeedsYouKind, number>> }) {
  if (total === 0) return <p className="text-[13px] text-muted">Nothing needs you right now.</p>;
  return (
    <Link to="/needs-you" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-[#ff375f]/10 px-5 py-4 hover:bg-[#ff375f]/15">
      <span className="text-[15px] font-semibold text-[#c4123f]">
        {total} {total === 1 ? 'thing needs' : 'things need'} you
      </span>
      <span className="text-[13px] text-[#c4123f]/80">
        {(Object.entries(byKind) as [NeedsYouKind, number][]).map(([kind, n]) => `${n} ${needsLabel[kind]}`).join(' · ')}
      </span>
      <span className="ml-auto text-[13px] text-[#c4123f]">Open →</span>
    </Link>
  );
}

function ProjectCard({ overview }: { overview: ProjectOverview }) {
  const { project, counts, done, total, active, needsYou, costUsd, agentTimeMs, merged, mergeBlocked } = overview;
  const activeProject = useActiveProject();
  const setActive = useSetActiveProject();
  const navigate = useNavigate();
  const open = async () => {
    await setActive.mutateAsync(project.id);
    navigate('/project');
  };
  const progress = total ? Math.round((done / total) * 100) : 0;
  const shown = (['ready', 'blocked', 'needs_you', 'failed'] as const).filter((s) => counts[s]);

  return (
    <article className={`rounded-[var(--radius-card)] border bg-surface p-5 ${project.id === activeProject?.id ? 'border-accent' : 'border-line'}`}>
      <button type="button" onClick={() => void open()} className="block w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[17px] font-semibold">{project.name}</span>
          {needsYou > 0 && <span className="rounded-full bg-[#ff375f] px-2 text-xs font-medium text-white">{needsYou} need you</span>}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/60">
          <div className="h-full rounded-full bg-[#30d158]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {done} of {total} tasks done
          {shown.length > 0 && ` · ${shown.map((s) => `${counts[s]} ${statusLabel[s]?.toLowerCase()}`).join(' · ')}`}
        </p>
      </button>

      {mergeBlocked && <p className="mt-3 rounded-lg bg-[#ff375f]/10 px-3 py-2 text-xs text-[#c4123f]">{mergeBlocked}</p>}

      <ul className="mt-4 space-y-1.5">
        {active.length === 0 && <li className="text-[13px] text-muted">Nothing runs now.</li>}
        {active.map((work) => (
          <li key={work.task.id}>
            <Link to={work.runId ? `/runs/${work.runId}` : `/tasks/${work.task.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[13px] hover:bg-canvas">
              <StatusDot status={work.task.status} />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted">#{work.task.number}</span> {work.task.title}
              </span>
              <span className="shrink-0 rounded-full bg-accent-soft px-2 text-xs text-accent">
                {work.step}
                {work.attempt && work.attempt > 1 ? ` ×${work.attempt}` : ''}
              </span>
              <span className="shrink-0 text-xs text-muted">{timeAgo(work.since)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
        {cost(costUsd)} · {duration(agentTimeMs)} of agent time · {merged} merged
      </p>
    </article>
  );
}
