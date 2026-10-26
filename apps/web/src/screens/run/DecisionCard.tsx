import { decisionKindLabel, type Decision } from '@megalodon/contracts';
import { useState } from 'react';
import { useOverrideDecision } from '../../data/runs';
import { timeAgo } from '../../lib/format';
import { Button } from '../../ui/Button';
import { ErrorText, Field, TextArea } from '../../ui/Field';
import { Modal } from '../../ui/Overlay';

const positive = new Set(['pass', 'approve']);
const negative = new Set(['fail', 'request_changes', 'stop']);

/** A decision in the timeline: who decided what and why, and a way to decide otherwise. */
export function DecisionCard({ decision }: { decision: Decision }) {
  const [open, setOpen] = useState(false);
  const findings = Array.isArray(decision.inputs.findings)
    ? (decision.inputs.findings as { severity: string; file: string | null; message: string }[])
    : [];
  const overridable = !decision.supersededBy && decision.alternatives.some((a) => a !== decision.outcome);
  const tone = positive.has(decision.outcome) ? 'text-[#30d158]' : negative.has(decision.outcome) ? 'text-[#ff375f]' : 'text-accent';

  return (
    <div className={`rounded-[var(--radius-card)] border border-line bg-surface p-4 ${decision.supersededBy ? 'opacity-50' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-xs uppercase tracking-wide text-muted">{decisionKindLabel[decision.kind] ?? decision.kind}</span>
        <span className={`font-medium ${tone} ${decision.supersededBy ? 'line-through' : ''}`}>{decision.outcome.replace('_', ' ')}</span>
        {typeof decision.inputs.score === 'number' && <span className="text-xs text-muted">{decision.inputs.score}/10</span>}
        <span className="ml-auto text-xs text-muted">
          {actorName(decision)} · {timeAgo(decision.at)}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5">{decision.rationale}</p>
      {findings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span className={`w-14 shrink-0 text-xs ${f.severity === 'minor' ? 'text-muted' : 'text-[#ff375f]'}`}>{f.severity}</span>
              <span>
                {f.file && <span className="font-mono text-xs text-muted">{f.file} </span>}
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {decision.supersededBy && <p className="mt-2 text-xs text-muted">Overridden by a later decision.</p>}
      {overridable && (
        <Button variant="ghost" className="-ml-4 mt-2" onClick={() => setOpen(true)}>
          Decide otherwise…
        </Button>
      )}
      {open && <OverrideDialog decision={decision} onClose={() => setOpen(false)} />}
    </div>
  );
}

function OverrideDialog({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const options = decision.alternatives.filter((a) => a !== decision.outcome);
  const [outcome, setOutcome] = useState(options[0] ?? '');
  const [rationale, setRationale] = useState('');
  const override = useOverrideDecision(decision.id);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Decide otherwise"
      description={`${decisionKindLabel[decision.kind] ?? decision.kind}: now "${decision.outcome}". Your decision is recorded next to this one.`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOutcome(o)}
              className={`rounded-full border px-3 py-1 text-[13px] ${o === outcome ? 'border-ink bg-ink text-surface' : 'border-line'}`}
            >
              {o.replace('_', ' ')}
            </button>
          ))}
        </div>
        <Field label="Why">
          <TextArea rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} className="font-sans" />
        </Field>
        <ErrorText error={override.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!rationale.trim() || !outcome || override.isPending}
            onClick={() => override.mutate({ outcome, rationale }, { onSuccess: onClose })}
          >
            Record decision
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function actorName({ actor }: Decision): string {
  switch (actor.kind) {
    case 'operator':
      return 'You';
    case 'agent':
      return `${actor.agentId} v${actor.version.slice(0, 7)}`;
    case 'policy':
      return actor.policy;
    case 'system':
      return 'Megalodon';
  }
}
