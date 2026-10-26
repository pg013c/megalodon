import { useNavigate } from 'react-router';
import { useActiveProject, useProjects, useSetActiveProject } from '../data/projects';
import { timeAgo } from '../lib/format';
import { useUiState } from '../shell/UiState';
import { Button } from '../ui/Button';
import { Empty } from '../ui/Empty';
import { QueuePanel } from './QueuePanel';

/** Every project at a glance. Status, Needs you and metrics arrive with later MVP steps. */
export function Overview() {
  const projects = useProjects();
  const active = useActiveProject();
  const setActive = useSetActiveProject();
  const { setConnectOpen } = useUiState();
  const navigate = useNavigate();

  const open = async (id: string) => {
    await setActive.mutateAsync(id);
    navigate('/project');
  };

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
        {!!projects.data?.length && <Button onClick={() => setConnectOpen(true)}>Connect project</Button>}
      </div>

      {!!projects.data?.length && (
        <div className="mt-8">
          <QueuePanel />
        </div>
      )}

      <div className="mt-8">
        {projects.data?.length === 0 && (
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
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data?.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => void open(project.id)}
              className={`rounded-[var(--radius-card)] border bg-surface p-5 text-left transition hover:shadow-md ${
                project.id === active?.id ? 'border-accent' : 'border-line'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[15px] font-semibold">{project.name}</span>
                {project.id === active?.id && <span className="text-xs text-accent">Active</span>}
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted">{project.path}</p>
              <p className="mt-4 text-xs text-muted">
                Base <span className="font-mono text-ink">{project.settings.baseBranch}</span> · connected{' '}
                {timeAgo(project.connectedAt)}
              </p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
