import { NavLink, Outlet } from 'react-router';
import { CommandPalette } from './CommandPalette';
import { screens } from './screens';

export function Layout() {
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
          <span className="text-[15px] font-semibold tracking-tight">Megalodon</span>
          <nav className="flex gap-1 overflow-x-auto">
            {screens
              .filter((screen) => screen.inNav)
              .map((screen) => (
                <NavLink
                  key={screen.id}
                  to={screen.path}
                  end={screen.path === '/'}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-full px-3 py-1 text-[13px] ${
                      isActive ? 'bg-ink text-surface' : 'text-muted hover:text-ink'
                    }`
                  }
                >
                  {screen.title}
                </NavLink>
              ))}
          </nav>
          <kbd className="ml-auto hidden text-xs text-muted sm:block">⌘K</kbd>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}
