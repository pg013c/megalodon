import type { NeedsYouItem, NeedsYouKind } from '@megalodon/contracts';
import { Link } from 'react-router';
import { useNeedsYou } from '../data/needsYou';
import { useOverrideDecision } from '../data/runs';
import { useTaskAction, type TaskAction } from '../data/work';
import { timeAgo } from '../lib/format';
import { taskPath } from '../shell/screens';
import { Button } from '../ui/Button';
import { Empty } from '../ui/Empty';
import { ErrorText } from '../ui/Field';

const kindLabel: Record<NeedsYouKind, string> = {
  plan: 'Plan to approve',
  review: 'Review',
  failed: 'Failed',
  manual: 'For you to do',
  queue: 'Waiting to be queued',
  triage: 'Triage failed',
};

const kindTone: Record<NeedsYouKind, string> = {
  plan: 'bg-accent-soft text-accent',
  review: 'bg-accent-soft text-accent',
  failed: 'bg-[#ff3b30]/10 text-[#ff3b30]',
  manual: 'bg-[#ff375f]/10 text-[#ff375f]',
  queue: 'bg-line/60 text-muted',
  triage: 'bg-[#ff9f0a]/10 text-[#c76e00]',
};

/** Everything that waits for you, across projects; the one action each needs is right there. */
export function NeedsYouScreen() {
  const needs = useNeedsYou();
  if (needs.error) return <ErrorText error={needs.error} />;
  if (!needs.data) return null;
  const { items, mergeBlocked, scheduler } = needs.data;
  const nothing = items.length === 0 && mergeBlocked.length === 0 && !scheduler.paused;

  return (
    <section className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">Needs you</h1>
      <p className="mt-2 text-[15px] text-muted">{nothing ? 'Nothing waits for you.' : 'The oldest first.'}</p>

      <div className="mt-8 space-y-3">
        {scheduler.paused && (
          <Banner tone="amber">
            {scheduler.paused === 'plan_limit'
              ? `The queue is paused: the plan's usage limit was reached. It resumes ${scheduler.pausedUntil ? timeAgo(scheduler.pausedUntil) : 'later'}.`
              : 'The queue is paused. Resume it on the Overview.'}
          </Banner>
        )}
        {mergeBlocked.map((b) => (
          <Banner key={b.projectId} tone="red">
            <span className="font-medium">{b.projectName}: merges wait.</span> {b.reason}
          </Banner>
        ))}
        {nothing && <Empty title="All clear">Megalodon will put here whatever needs a decision or a hand.</Empty>}
        {items.map((item) => (
          <Item key={`${item.kind}:${item.task.id}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function Banner({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }) {
  return (
    <p className={`rounded-[var(--radius-card)] px-4 py-3 text-[13px] ${tone === 'red' ? 'bg-[#ff375f]/10 text-[#c4123f]' : 'bg-[#ff9f0a]/10 text-[#c76e00]'}`}>
      {children}
    </p>
  );
}

function Item({ item }: { item: NeedsYouItem }) {
  const { task } = item;
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${kindTone[item.kind]}`}>{kindLabel[item.kind]}</span>
        <span className="text-xs text-muted">
          {item.projectName} · {timeAgo(item.since)}
        </span>
      </div>
      <Link to={taskPath(task.id)} className="mt-2 block text-[15px] font-medium hover:underline">
        <span className="text-muted">#{task.number}</span> {task.title}
      </Link>
      {item.reason && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted">{item.reason}</p>}
      <Actions item={item} />
    </article>
  );
}

function Actions({ item }: { item: NeedsYouItem }) {
  const action = useTaskAction(item.task.id);
  const override = useOverrideDecision(item.decisionId ?? '');
  const run = (a: TaskAction) => action.mutate({ action: a });
  const decide = (outcome: string) => override.mutate({ outcome, rationale: 'Decided on the Needs you screen.' });
  const busy = action.isPending || override.isPending;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {item.kind === 'plan' && item.decisionId && (
        <Button variant="primary" disabled={busy} onClick={() => decide('approve')}>
          Approve plan
        </Button>
      )}
      {item.kind === 'review' && item.mergeable && (
        <Button variant="primary" disabled={busy} onClick={() => run('merge')}>
          Merge
        </Button>
      )}
      {item.kind === 'failed' && (
        <Button variant="primary" disabled={busy} onClick={() => run('retry')}>
          Back to the queue
        </Button>
      )}
      {item.kind === 'manual' && (
        <Button variant="primary" disabled={busy} onClick={() => run('complete')}>
          Mark done
        </Button>
      )}
      {item.kind === 'queue' && item.decisionId && (
        <Button variant="primary" disabled={busy} onClick={() => decide('queue')}>
          Queue it
        </Button>
      )}
      {item.kind === 'triage' && (
        <>
          <Button variant="primary" disabled={busy} onClick={() => run('triage')}>
            Triage again
          </Button>
          <Button disabled={busy} onClick={() => run('queue')}>
            Queue without triage
          </Button>
        </>
      )}
      {item.runId && (
        <Link to={`/runs/${item.runId}`} className="px-2 text-[13px] text-accent">
          Open run →
        </Link>
      )}
      <ErrorText error={action.error ?? override.error} />
    </div>
  );
}
