import type { AgentScore, Period, PipelineScore, ReviewerScore, Scorecard } from '@megalodon/contracts';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useActiveProject } from '../../data/projects';
import { useScorecard, useScorecardRuns, type ScorecardTarget } from '../../data/scorecard';
import { cost, duration, percent, score, timeAgo } from '../../lib/format';
import { periods } from '../../lib/periods';
import { statusLabel } from '../../lib/status';
import { Empty } from '../../ui/Empty';
import { ErrorText } from '../../ui/Field';
import { Drawer } from '../../ui/Overlay';
import { Segmented } from '../../ui/Segmented';
import { StatusDot } from '../../ui/StatusBadge';

type Scope = 'project' | 'all';

/** A row the operator opened: what to fetch, and how to title the drawer. */
interface Opened {
  target: ScorecardTarget;
  name: string;
  /** Decisions-only agents (triage) have decisions but no runs to list. */
  decisions: number;
}

const short = (version: string) => version.slice(0, 7);

/** How each agent and pipeline version did, so a prompt change can be compared with the version before it (PRD FR-13). */
export function ScorecardView() {
  const active = useActiveProject();
  const [period, setPeriod] = useState<Period>('30d');
  const [chosen, setChosen] = useState<Scope | null>(null);
  const scope: Scope = active ? (chosen ?? 'project') : 'all';
  const projectId = scope === 'project' && active ? active.id : null;
  const card = useScorecard(period, projectId);
  const [open, setOpen] = useState<Opened | null>(null);

  const periodLabel = periods.find((p) => p.value === period)!.label;
  const where = scope === 'project' && active ? active.name : 'all projects';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-[13px] text-muted">
          {period === 'all' ? 'All time' : `Last ${periodLabel}`} · {where}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {active && (
            <Segmented
              value={scope}
              options={[
                { value: 'project', label: 'This project' },
                { value: 'all', label: 'All projects' },
              ]}
              onChange={setChosen}
            />
          )}
          <Segmented value={period} options={periods} onChange={setPeriod} />
        </div>
      </div>
      <ErrorText error={card.error} />
      {card.data && (
        <ScorecardTables
          card={card.data}
          onOpen={setOpen}
          hint={scope === 'project' ? 'Pick a longer period, or All projects.' : 'Pick a longer period, or start a run.'}
        />
      )}
      <RunsDrawer opened={open} onClose={() => setOpen(null)} period={period} projectId={projectId} where={where} periodLabel={periodLabel} />
    </div>
  );
}

export function ScorecardTables({ card, onOpen, hint }: { card: Scorecard; onOpen: (opened: Opened) => void; hint: string }) {
  if (card.agents.length === 0 && card.pipelines.length === 0) return <Empty title="No runs in this period">{hint}</Empty>;
  return (
    <div className="space-y-10">
      {card.agents.length > 0 && (
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Agents</h2>
          <div className="mt-3">
            <AgentScoreTable agents={card.agents} onOpen={onOpen} />
          </div>
        </div>
      )}
      {card.pipelines.length > 0 && (
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Pipelines</h2>
          <div className="mt-3">
            <PipelineScoreTable pipelines={card.pipelines} onOpen={onOpen} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Rows of the same id together, in the API's order (current version first). */
function grouped<T>(rows: readonly T[], id: (row: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(id(row), [...(groups.get(id(row)) ?? []), row]);
  return [...groups.values()];
}

// a version column, then seven numbers; the reviewer strip of a compare group uses it too
const grid = 'grid grid-cols-[minmax(10rem,1.6fr)_repeat(7,minmax(0,1fr))] items-center gap-3';

export function AgentScoreTable({ agents, onOpen }: { agents: readonly AgentScore[]; onOpen: (opened: Opened) => void }) {
  return (
    <ScoreTable header={['Version', 'Runs', 'Success', 'Rework', 'Review', 'Cost', 'Avg time', 'Overrides']}>
      {grouped(agents, (a) => a.agentId).map((versions) => {
        const first = versions[0]!;
        const name = first.name ?? first.agentId;
        return (
          <Group
            key={first.agentId}
            title={name}
            subtitle={first.name ? first.agentId : 'removed from library'}
            compare={versions.length > 1}
            footer={versions.length > 1 && versions.some((a) => a.reviewer) ? <ReviewerComparison versions={versions} /> : null}
          >
            {versions.map((a) => (
              <Row
                key={a.agentVersion}
               
                onClick={() => onOpen({ target: { kind: 'agent', id: a.agentId, version: a.agentVersion }, name, decisions: a.decisions })}
              >
                <Version version={a.agentVersion} current={a.current} />
                <span>{a.runs}</span>
                <span>{percent(a.successRate)}</span>
                <span>{a.rework}</span>
                {a.reviewer ? <ReviewerCell r={a.reviewer} /> : <Cell main={score(a.reviewScore)} sub={a.reviewed > 0 ? `${a.reviewed} reviewed` : null} />}
                <Cell main={cost(a.costUsd)} sub={a.avgCostUsd !== null ? `${cost(a.avgCostUsd)} / attempt` : null} />
                <span>{duration(a.avgDurationMs)}</span>
                <span>{a.decisions === 0 ? '—' : `${a.overridden} / ${a.decisions}`}</span>
              </Row>
            ))}
          </Group>
        );
      })}
    </ScoreTable>
  );
}

export function PipelineScoreTable({ pipelines, onOpen }: { pipelines: readonly PipelineScore[]; onOpen: (opened: Opened) => void }) {
  return (
    <ScoreTable header={['Version', 'Runs', 'Finished', 'Merged', 'Unattended', 'Avg attempts', 'Cost', 'Avg time']}>
      {grouped(pipelines, (p) => p.pipelineId).map((versions) => {
        const first = versions[0]!;
        const name = first.name ?? first.pipelineId;
        return (
          <Group key={first.pipelineId} title={name} subtitle={first.name ? first.pipelineId : 'removed from library'} compare={versions.length > 1}>
            {versions.map((p) => (
              <Row
                key={p.pipelineVersion}
               
                onClick={() => onOpen({ target: { kind: 'pipeline', id: p.pipelineId, version: p.pipelineVersion }, name, decisions: 0 })}
              >
                <Version version={p.pipelineVersion} current={p.current} />
                <span>{p.runs}</span>
                <span>{p.finished}</span>
                <span>{p.merged}</span>
                <Cell main={percent(p.unattendedRate)} sub={p.finished > 0 ? `${p.mergedUnattended} of ${p.finished}` : null} />
                <span>{p.avgAttempts === null ? '—' : p.avgAttempts.toFixed(1)}</span>
                <Cell main={cost(p.costUsd)} sub={p.avgCostUsd !== null ? `${cost(p.avgCostUsd)} / run` : null} />
                <span>{duration(p.avgDurationMs)}</span>
              </Row>
            ))}
          </Group>
        );
      })}
    </ScoreTable>
  );
}

function ScoreTable({ header, children }: { header: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="min-w-[760px]">
        <div className={`${grid} border-b border-line px-4 py-2 text-xs text-muted`}>
          {header.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        <ul className="divide-y divide-line">{children}</ul>
      </div>
    </div>
  );
}

const findings = (f: ReviewerScore['findings'], digits = 0) => `${f.blocker.toFixed(digits)}/${f.major.toFixed(digits)}/${f.minor.toFixed(digits)}`;

/** How a reviewer version judged, in place of the review score it never gets (ADR-0033). */
function ReviewerCell({ r }: { r: ReviewerScore }) {
  return (
    <span className="flex flex-col">
      <span>
        Approved {r.approved}/{r.verdicts}
      </span>
      <span className="text-xs text-muted">Score given {score(r.avgScore)}</span>
      <span className="text-xs text-muted">Findings {findings(r.findings)}</span>
      {r.gated > 0 && <span className="text-xs text-muted">Sent back {percent(r.sentBackRate)}</span>}
    </span>
  );
}

/** The verdicts of a reviewer's versions side by side, under its version rows. */
function ReviewerComparison({ versions }: { versions: readonly AgentScore[] }) {
  return (
    <div className="mx-4 mt-2 rounded-lg bg-canvas py-1.5 text-[13px] tabular-nums">
      <div className={`${grid} pb-1 text-xs text-muted`}>
        {['Reviewer verdicts', 'Approved', 'Approval', 'Score given', 'Findings b/M/m', 'Per review', 'Sent back'].map((h) => (
          <span key={h} className="first:pl-3">
            {h}
          </span>
        ))}
      </div>
      {versions.map(({ agentVersion, current, reviewer: r }) => (
        <div key={agentVersion} className={grid}>
          <span className="pl-3">
            <Version version={agentVersion} current={current} />
          </span>
          {r ? (
            <>
              <span>
                {r.approved}/{r.verdicts}
              </span>
              <span>{percent(r.approvalRate)}</span>
              <span>{score(r.avgScore)}</span>
              <span>{findings(r.findings)}</span>
              <span>{findings(r.findingsPerReview, 1)}</span>
              <span>{r.gated > 0 ? `${percent(r.sentBackRate)} of ${r.gated}` : '—'}</span>
            </>
          ) : (
            <span className="col-span-6 text-muted">—</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One agent or pipeline; two or more versions get a rule on the left so they read as a comparison. */
function Group({ title, subtitle, compare, footer = null, children }: { title: string; subtitle: string; compare: boolean; footer?: ReactNode; children: ReactNode }) {
  return (
    <li className="py-2">
      <p className="px-4 pt-1 text-[13px]">
        <span className="font-semibold">{title}</span> <span className="font-mono text-xs text-muted">{subtitle}</span>
      </p>
      <div className="relative mt-1">
        {compare && <span aria-hidden className="absolute inset-y-1 left-2 w-0.5 rounded-full bg-accent/30" />}
        {children}
      </div>
      {footer}
    </li>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`${grid} w-full px-4 py-1.5 text-left text-[13px] tabular-nums hover:bg-canvas`}>
      {children}
    </button>
  );
}

function Version({ version, current }: { version: string; current: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-xs">v{short(version)}</span>
      {current && <span className="rounded-full bg-accent-soft px-2 text-xs text-accent">Current</span>}
    </span>
  );
}

function Cell({ main, sub }: { main: string; sub: string | null }) {
  return (
    <span className="flex flex-col">
      <span>{main}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </span>
  );
}

function RunsDrawer({
  opened,
  onClose,
  period,
  projectId,
  where,
  periodLabel,
}: {
  opened: Opened | null;
  onClose: () => void;
  period: Period;
  projectId: string | null;
  where: string;
  periodLabel: string;
}) {
  const runs = useScorecardRuns(opened?.target ?? null, period, projectId);
  const data = runs.data;
  return (
    <Drawer
      open={opened !== null}
      onOpenChange={(o) => !o && onClose()}
      title={opened ? `${opened.name} · v${short(opened.target.version)}` : ''}
      description={`Runs behind the numbers · ${period === 'all' ? 'all time' : `last ${periodLabel}`} · ${where}`}
    >
      <ErrorText error={runs.error} />
      {data && data.total === 0 && (
        <p className="text-[13px] text-muted">
          {opened && opened.decisions > 0
            ? `Its ${opened.decisions} ${opened.decisions === 1 ? 'decision was' : 'decisions were'} made outside runs, so there are no runs to list.`
            : 'No runs in this period.'}
        </p>
      )}
      {data && data.total > data.runs.length && (
        <p className="mb-2 text-xs text-muted">
          Latest {data.runs.length} of {data.total}
        </p>
      )}
      <ul className="space-y-0.5">
        {data?.runs.map((run) => (
          <li key={run.runId}>
            <Link to={`/runs/${run.runId}`} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-canvas">
              <StatusDot status={run.status} />
              <span className="min-w-0 flex-1 truncate">
                {run.taskNumber !== null ? (
                  <>
                    <span className="text-muted">#{run.taskNumber}</span> {run.taskTitle}
                  </>
                ) : (
                  <span className="font-mono text-xs">{run.runId}</span>
                )}
                {projectId === null && <span className="text-muted"> · {run.projectName ?? 'disconnected project'}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {[
                  statusLabel[run.status] ?? run.status,
                  run.merged ? 'merged' : null,
                  `${run.attempts} ${run.attempts === 1 ? 'attempt' : 'attempts'}`,
                  run.rework > 0 ? `${run.rework} rework` : null,
                  run.reviewScore !== null ? `review ${score(run.reviewScore)}` : null,
                  cost(run.costUsd),
                  duration(run.durationMs),
                  timeAgo(run.startedAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
