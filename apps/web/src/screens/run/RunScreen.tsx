import type { PlannedStep, RunDetails, RunStep, StoredEvent, TimelineEntry } from '@megalodon/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useEventListener } from '../../data/live';
import { useRun, useStopRun } from '../../data/runs';
import { useTaskDetails } from '../../data/work';
import { cost, duration, timeAgo, tokens } from '../../lib/format';
import { taskPath } from '../../shell/screens';
import { Button } from '../../ui/Button';
import { CopyButton } from '../../ui/CopyButton';
import { ErrorText } from '../../ui/Field';
import { StatusBadge, StatusDot } from '../../ui/StatusBadge';
import { DecisionCard } from './DecisionCard';

/** One run: where it is in its plan, what it cost, and everything the agent did, live. */
export function RunScreen() {
  const { runId = '' } = useParams();
  const details = useRun(runId);
  if (details.error) return <ErrorText error={details.error} />;
  if (!details.data) return null;
  return <RunView key={runId} details={details.data} />;
}

function RunView({ details }: { details: RunDetails }) {
  const { run, steps } = details;
  const task = useTaskDetails(run.taskId).data?.task;
  const stop = useStopRun(run.id);
  const timeline = useLiveTimeline(run.id, details.timeline);

  return (
    <section className="max-w-4xl">
      {task && (
        <Link to={taskPath(task.id)} className="text-[13px] text-muted hover:text-ink">
          ← #{task.number} {task.title}
        </Link>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <h1 className="font-mono text-xl tracking-tight">{run.branch}</h1>
        <CopyButton text={run.branch} label="Copy branch" />
        <span className="text-xs text-muted">
          {run.pipelineId} · v{run.pipelineVersion.slice(0, 7)}
        </span>
        <StatusBadge status={run.status} />
        {run.status === 'running' && (
          <Button className="ml-auto" disabled={stop.isPending} onClick={() => stop.mutate()}>
            Stop
          </Button>
        )}
      </div>
      <ErrorText error={stop.error} />
      {run.error && <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-[13px] text-muted">{run.error}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Duration" value={run.status === 'running' ? `started ${timeAgo(run.startedAt)}` : duration(run.durationMs)} />
        <Stat label="Cost" value={cost(run.usage.costUsd)} />
        <Stat label="Tokens in / out" value={`${tokens(run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens)} / ${tokens(run.usage.outputTokens)}`} />
        <Stat label="Commit" value={run.commitSha ? run.commitSha.slice(0, 8) : '—'} mono />
      </dl>

      <Pipeline plan={details.plan} steps={steps} running={run.status === 'running'} />
      <Timeline entries={timeline} plan={details.plan} />
    </section>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 text-[15px] ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

/** Where the run is in its pipeline: each planned step with its latest attempt. */
function Pipeline({ plan, steps, running }: { plan: PlannedStep[]; steps: RunStep[]; running: boolean }) {
  return (
    <ol className="mt-8 flex flex-wrap items-center gap-2 text-[13px]">
      {plan.map((planned, i) => {
        const attempts = steps.filter((s) => s.stepId === planned.stepId);
        const latest = attempts.at(-1);
        const cost$ = attempts.reduce((sum, s) => sum + s.usage.costUsd, 0);
        return (
          <li key={planned.stepId} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted">→</span>}
            <span
              className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
                latest?.status === 'running' ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
              } ${!latest ? 'text-muted' : ''}`}
            >
              {latest ? <StatusDot status={latest.status} /> : <span className="size-2 rounded-full border border-line" />}
              {planned.name}
              {attempts.length > 1 && <span className="text-xs text-muted">×{attempts.length}</span>}
              {latest && latest.status !== 'running' && <span className="text-xs text-muted">{duration(attempts.reduce((sum, s) => sum + (s.durationMs ?? 0), 0))}</span>}
              {cost$ > 0 && <span className="text-xs text-muted">{cost(cost$)}</span>}
              {!latest && running && <span className="text-xs">waiting</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The stored timeline, extended with messages as they arrive on the event stream. */
function useLiveTimeline(runId: string, initial: TimelineEntry[]): TimelineEntry[] {
  const [entries, setEntries] = useState(initial);
  const last = useRef(initial.at(-1)?.seq ?? 0);
  useEffect(() => {
    // a refetch (e.g. after a step completes) brings the full list
    if ((initial.at(-1)?.seq ?? 0) >= last.current) {
      last.current = initial.at(-1)?.seq ?? 0;
      setEntries(initial);
    }
  }, [initial]);
  const onEvent = useCallback(
    (event: StoredEvent) => {
      if (event.type !== 'step.message' || event.seq <= last.current) return;
      const data = event.data as { runId: string; stepId: string; message: Extract<TimelineEntry['item'], { type: 'message' }>['message'] };
      if (data.runId !== runId) return;
      last.current = event.seq;
      setEntries((list) => [...list, { seq: event.seq, at: event.at, stepId: data.stepId, item: { type: 'message', message: data.message } }]);
    },
    [runId],
  );
  useEventListener(onEvent);
  return entries;
}

function Timeline({ entries, plan }: { entries: TimelineEntry[]; plan: PlannedStep[] }) {
  const names = new Map(plan.map((s) => [s.stepId, s.name]));
  const results = new Map(
    entries.flatMap((e) => (e.item.type === 'message' && e.item.message.kind === 'tool_result' ? [[e.item.message.toolUseId, e.item.message] as const] : [])),
  );
  let currentStep: string | null = '';
  return (
    <ol className="mt-8 space-y-3">
      {entries.map((entry) => {
        const header = entry.stepId !== currentStep && entry.stepId ? (names.get(entry.stepId) ?? entry.stepId) : null;
        currentStep = entry.stepId;
        const heading = header && <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted">{header}</h2>;
        if (entry.item.type === 'decision') {
          return (
            <li key={entry.seq}>
              {heading}
              <DecisionCard decision={entry.item.decision} />
            </li>
          );
        }
        const m = entry.item.message;
        if (m.kind === 'tool_result') return null; // shown with its call
        return (
          <li key={entry.seq}>
            {heading}
            {m.kind === 'text' && <p className="whitespace-pre-wrap text-[14px] leading-6">{m.text}</p>}
            {m.kind === 'output' && <pre className="overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-xs leading-5">{m.text}</pre>}
            {m.kind === 'tool_use' && <ToolCall name={m.name} input={m.input} result={results.get(m.toolUseId)} />}
          </li>
        );
      })}
    </ol>
  );
}

function ToolCall({ name, input, result }: { name: string; input: string; result?: { isError: boolean; content: string } }) {
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-default list-none items-center gap-2 px-3 py-2 text-[13px]">
        <span className={`size-1.5 rounded-full ${result ? (result.isError ? 'bg-[#ff3b30]' : 'bg-[#30d158]') : 'bg-muted/50'}`} />
        <span className="font-medium">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{summarize(input)}</span>
      </summary>
      <div className="space-y-2 border-t border-line p-3">
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted">{input}</pre>
        {result && <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-xs">{result.content}</pre>}
      </div>
    </details>
  );
}

/** The most telling field of a tool call's input: a path, a command or a pattern. */
function summarize(input: string): string {
  try {
    const value = JSON.parse(input) as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'command', 'pattern', 'url', 'query']) {
      if (typeof value[key] === 'string') return value[key];
    }
  } catch {
    // clipped input is not valid JSON
  }
  return input.slice(0, 120);
}
