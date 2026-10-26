import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useActiveProject, useProjects, useSetActiveProject } from '../data/projects';
import { screens } from './screens';
import { useUiState } from './UiState';

const group = 'text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5';
const itemClass =
  'flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm text-ink data-[selected=true]:bg-accent-soft';

/** Cmd+K: every action of the app is reachable from here (PRD FR-18). */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const projects = useProjects();
  const active = useActiveProject();
  const setActive = useSetActiveProject();
  const { setConnectOpen } = useUiState();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      const screen = screens.find((s) => s.key === event.key);
      if (screen) {
        event.preventDefault();
        navigate(screen.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 bg-black/20 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[20vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-2xl"
    >
      <Command.Input
        placeholder="Type a command or search…"
        className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-muted"
      />
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No results</Command.Empty>
        <Command.Group heading="Go to" className={group}>
          {screens.map((screen) => (
            <Command.Item
              key={screen.id}
              value={screen.title}
              onSelect={() => go(screen.path)}
              className={itemClass}
            >
              {screen.title}
              <kbd className="text-xs text-muted">⌘{screen.key}</kbd>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Projects" className={group}>
          {projects.data
            ?.filter((project) => project.id !== active?.id)
            .map((project) => (
              <Command.Item
                key={project.id}
                value={`Switch to ${project.name}`}
                onSelect={() => {
                  setOpen(false);
                  setActive.mutate(project.id);
                }}
                className={itemClass}
              >
                Switch to {project.name}
              </Command.Item>
            ))}
          <Command.Item
            value="Connect project"
            onSelect={() => {
              setOpen(false);
              setConnectOpen(true);
            }}
            className={itemClass}
          >
            Connect project…
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
