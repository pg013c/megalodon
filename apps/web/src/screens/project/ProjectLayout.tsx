import type { Project } from '@megalodon/contracts';
import { NavLink, Outlet, useOutletContext } from 'react-router';
import { useActiveProject } from '../../data/projects';
import { useUiState } from '../../shell/UiState';
import { Button } from '../../ui/Button';
import { Empty } from '../../ui/Empty';

const tabs = [
  { to: '/project', label: 'Board', end: true },
  { to: '/project/backlog', label: 'Backlog', end: false },
  { to: '/project/branches', label: 'Branches', end: false },
  { to: '/project/settings', label: 'Settings', end: false },
];

/** The active project's screen; its sections share one header. */
export function ProjectLayout() {
  const project = useActiveProject();
  const { setConnectOpen } = useUiState();

  if (project === undefined) return null;
  if (project === null) {
    return (
      <Empty
        title="No active project"
        action={
          <Button variant="primary" onClick={() => setConnectOpen(true)}>
            Connect a project
          </Button>
        }
      >
        Pick a project in the switcher at the top, or connect a new one.
      </Empty>
    );
  }

  return (
    <section>
      <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
      <p className="mt-1 font-mono text-xs text-muted">{project.path}</p>
      <nav className="mt-6 inline-flex rounded-full bg-line/60 p-0.5">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `rounded-full px-4 py-1 text-[13px] ${isActive ? 'bg-surface font-medium shadow-sm' : 'text-muted hover:text-ink'}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-8">
        <Outlet context={project} key={project.id} />
      </div>
    </section>
  );
}

export const useProject = () => useOutletContext<Project>();
