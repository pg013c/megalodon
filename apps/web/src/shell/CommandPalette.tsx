import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { screens } from './screens';

/** Cmd+K: every action of the app is reachable from here (PRD FR-18). */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

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
        <Command.Group heading="Go to" className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
          {screens.map((screen) => (
            <Command.Item
              key={screen.id}
              value={screen.title}
              onSelect={() => go(screen.path)}
              className="flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm text-ink data-[selected=true]:bg-accent-soft"
            >
              {screen.title}
              <kbd className="text-xs text-muted">⌘{screen.key}</kbd>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
