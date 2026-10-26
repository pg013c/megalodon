import { statusDot, statusLabel } from '../lib/status';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`size-2 rounded-full ${statusDot[status] ?? 'bg-line'}`} />
      {statusLabel[status] ?? status}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`size-2 shrink-0 rounded-full ${statusDot[status] ?? 'bg-line'}`} aria-label={statusLabel[status] ?? status} />;
}
