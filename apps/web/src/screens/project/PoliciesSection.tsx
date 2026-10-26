import type { Policies } from '@megalodon/contracts';
import { Input } from '../../ui/Field';
import { Segmented } from '../../ui/Segmented';

type Mode3 = 'auto' | 'auto_if' | 'operator';

const gates: { key: keyof Policies; title: string; when: string; autoIf: string | null }[] = [
  { key: 'queue', title: 'Queue after triage', when: 'A triaged task joins the queue.', autoIf: 'when triage found no manual tasks' },
  { key: 'plan', title: 'Plan approval', when: 'A pipeline continues after its plan.', autoIf: 'when the plan touches no sensitive path' },
  { key: 'merge', title: 'Merge', when: 'A finished run goes to the merge queue.', autoIf: 'when the review approves with the minimum score and no sensitive path changed' },
  { key: 'conflicts', title: 'Conflicts', when: 'The resolver agent settles conflicts with the base.', autoIf: null },
  { key: 'push', title: 'Push', when: 'The base branch is pushed after every merge.', autoIf: null },
];

/** Every gate's policy (ADR-0028): automatic, automatic under conditions, or yours. */
export function PoliciesSection({ policies, onChange }: { policies: Policies; onChange: (p: Policies) => void }) {
  const set = <K extends keyof Policies>(key: K, value: Partial<Policies[K]>) => onChange({ ...policies, [key]: { ...policies[key], ...value } });
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line">
      {gates.map((gate) => {
        const policy = policies[gate.key];
        const options: { value: Mode3; label: string }[] = gate.autoIf
          ? [
              { value: 'auto', label: 'Automatic' },
              { value: 'auto_if', label: 'If…' },
              { value: 'operator', label: 'Ask me' },
            ]
          : [
              { value: 'auto', label: 'Automatic' },
              { value: 'operator', label: 'Ask me' },
            ];
        return (
          <div key={gate.key} className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{gate.title}</p>
              <p className="text-xs text-muted">
                {gate.when}
                {policy.mode === 'auto_if' && gate.autoIf ? ` Automatic ${gate.autoIf}.` : ''}
              </p>
            </div>
            {gate.key === 'merge' && policy.mode === 'auto_if' && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                min score
                <Input
                  className="w-14"
                  inputMode="numeric"
                  value={String(policies.merge.minScore)}
                  onChange={(e) => set('merge', { minScore: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                />
              </label>
            )}
            {gate.key === 'conflicts' && policy.mode === 'auto' && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                attempts
                <Input
                  className="w-12"
                  inputMode="numeric"
                  value={String(policies.conflicts.attempts)}
                  onChange={(e) => set('conflicts', { attempts: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
                />
              </label>
            )}
            {gate.key === 'push' && policy.mode === 'auto' && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                to
                <Input className="w-24 font-mono" value={policies.push.remote} onChange={(e) => set('push', { remote: e.target.value })} />
              </label>
            )}
            <Segmented value={policy.mode as Mode3} options={options} onChange={(mode) => set(gate.key, { mode } as never)} />
          </div>
        );
      })}
    </div>
  );
}
