import * as Menu from '@radix-ui/react-dropdown-menu';
import { useActiveProject, useProjects, useSetActiveProject } from '../data/projects';
import { useUiState } from './UiState';

const item =
  'flex cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent-soft';

/** The active project is the working context of the whole UI (ADR-0011). */
export function ProjectSwitcher() {
  const projects = useProjects();
  const active = useActiveProject();
  const setActive = useSetActiveProject();
  const { setConnectOpen } = useUiState();

  return (
    <Menu.Root>
      <Menu.Trigger className="flex max-w-56 items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px] outline-none hover:bg-canvas">
        <span className="truncate">{active ? active.name : 'No project'}</span>
        <span className="text-[10px] text-muted">▾</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-30 min-w-56 rounded-xl border border-line bg-surface p-1 shadow-xl">
          {projects.data?.map((project) => (
            <Menu.Item key={project.id} className={item} onSelect={() => setActive.mutate(project.id)}>
              <span className="w-3 text-accent">{project.id === active?.id ? '✓' : ''}</span>
              <span className="truncate">{project.name}</span>
            </Menu.Item>
          ))}
          {!!projects.data?.length && <Menu.Separator className="my-1 h-px bg-line" />}
          <Menu.Item className={item} onSelect={() => setConnectOpen(true)}>
            <span className="w-3" />
            Connect project…
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
