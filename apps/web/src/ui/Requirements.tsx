import type { Requirement } from '@megalodon/contracts';

const icon: Record<Requirement['kind'], string> = { code: '⑂', manual: '✋', external: '◎', collision: '⇄' };

/** The unmet things a task waits for, in one quiet line. */
export function WaitingFor({ requirements }: { requirements: Requirement[] }) {
  const unmet = requirements.filter((r) => !r.met);
  if (!unmet.length) return null;
  return (
    <p className="mt-2 line-clamp-2 text-xs text-[#ff9f0a]">
      {unmet.map((r) => `${icon[r.kind]} ${r.label}`).join(' · ')}
    </p>
  );
}

export const requirementIcon = icon;
