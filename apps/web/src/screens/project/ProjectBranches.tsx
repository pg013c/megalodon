import type { Branch } from '@megalodon/contracts';
import { useState } from 'react';
import { useBranchDiff, useBranches, useFetchBranches, useFilePatch } from '../../data/projects';
import { patchLineKind, timeAgo, type PatchLineKind } from '../../lib/format';
import { Button } from '../../ui/Button';
import { ErrorText } from '../../ui/Field';
import { Drawer } from '../../ui/Overlay';
import { useProject } from './ProjectLayout';

export function ProjectBranches() {
  const project = useProject();
  const branches = useBranches(project.id);
  const fetch = useFetchBranches(project.id);
  const [selected, setSelected] = useState<string | null>(null);

  const local = branches.data?.filter((b) => b.kind === 'local') ?? [];
  const remote = branches.data?.filter((b) => b.kind === 'remote') ?? [];

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-muted">
          Compared with <span className="font-mono text-ink">{project.settings.baseBranch}</span>
        </p>
        <Button onClick={() => fetch.mutate()} disabled={fetch.isPending}>
          {fetch.isPending ? 'Fetching…' : 'Fetch'}
        </Button>
      </div>
      <div className="mt-2">
        <ErrorText error={fetch.error ?? branches.error} />
      </div>

      <BranchList title="Local" branches={local} onOpen={setSelected} />
      {remote.length > 0 && <BranchList title="Remote" branches={remote} onOpen={setSelected} />}

      <BranchDiffDrawer projectId={project.id} branch={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function BranchList({ title, branches, onOpen }: { title: string; branches: Branch[]; onOpen: (name: string) => void }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {branches.map((branch) => (
          <li key={branch.name}>
            <button
              type="button"
              disabled={branch.isBase}
              onClick={() => onOpen(branch.name)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left enabled:hover:bg-canvas"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px]">
                  {branch.name}
                  {branch.isBase && <span className="ml-2 font-sans text-xs text-muted">base</span>}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {branch.subject} · {branch.author} · {timeAgo(branch.committedAt)}
                </p>
              </div>
              {!branch.isBase && (
                <span className="shrink-0 font-mono text-xs text-muted" title="ahead / behind the base">
                  ↑{branch.ahead} ↓{branch.behind}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BranchDiffDrawer({ projectId, branch, onClose }: { projectId: string; branch: string | null; onClose: () => void }) {
  const diff = useBranchDiff(projectId, branch);
  const [file, setFile] = useState<string | null>(null);
  const files = diff.data?.files ?? [];

  return (
    <Drawer
      open={branch !== null}
      onOpenChange={(open) => {
        if (!open) {
          setFile(null);
          onClose();
        }
      }}
      title={branch ?? ''}
      description={diff.data ? `${files.length} file${files.length === 1 ? '' : 's'} changed since it left ${diff.data.base}` : undefined}
    >
      <ErrorText error={diff.error} />
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.path} className="overflow-hidden rounded-lg border border-line">
            <button
              type="button"
              onClick={() => setFile(file === f.path ? null : f.path)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-canvas"
            >
              <span className={`w-4 text-center font-mono text-xs ${statusColor[f.status]}`}>{statusMark[f.status]}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{f.path}</span>
              <span className="font-mono text-xs">
                {f.additions === null ? (
                  <span className="text-muted">binary</span>
                ) : (
                  <>
                    <span className="text-[#28a745]">+{f.additions}</span> <span className="text-[#ff3b30]">−{f.deletions}</span>
                  </>
                )}
              </span>
            </button>
            {file === f.path && branch && <Patch projectId={projectId} branch={branch} file={f.path} />}
          </li>
        ))}
      </ul>
      {diff.data && files.length === 0 && <p className="text-[13px] text-muted">No changes against the base.</p>}
    </Drawer>
  );
}

const statusMark = { added: 'A', modified: 'M', deleted: 'D', other: '•' } as const;
const statusColor = { added: 'text-[#28a745]', modified: 'text-accent', deleted: 'text-[#ff3b30]', other: 'text-muted' } as const;

const lineClass: Record<PatchLineKind, string> = {
  add: 'bg-[#28a745]/10',
  remove: 'bg-[#ff3b30]/10',
  hunk: 'text-accent',
  meta: 'text-muted',
  context: '',
};

function Patch({ projectId, branch, file }: { projectId: string; branch: string; file: string }) {
  const patch = useFilePatch(projectId, branch, file);
  if (patch.error) return <div className="px-3 pb-3"><ErrorText error={patch.error} /></div>;
  if (!patch.data) return <p className="px-3 pb-3 text-xs text-muted">Loading…</p>;
  if (patch.data.truncated) return <p className="px-3 pb-3 text-xs text-muted">This diff is too large to show.</p>;
  return (
    <pre className="overflow-x-auto border-t border-line bg-canvas py-2 font-mono text-xs leading-5">
      {patch.data.patch.split('\n').map((line, i) => (
        <div key={i} className={`px-3 ${lineClass[patchLineKind(line)]}`}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}
