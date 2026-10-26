/** The main screens (PRD FR-18). Order is the order of the navigation and the palette. */
export interface ScreenLink {
  id: string;
  title: string;
  path: string;
  /** Shortcut digit used with Cmd/Ctrl. */
  key: string;
  inNav: boolean;
}

export const screens: readonly ScreenLink[] = [
  { id: 'overview', title: 'Overview', path: '/', key: '1', inNav: true },
  { id: 'project', title: 'Project', path: '/project', key: '2', inNav: true },
  { id: 'needs-you', title: 'Needs you', path: '/needs-you', key: '3', inNav: true },
  { id: 'library', title: 'Agents & Pipelines', path: '/library', key: '4', inNav: true },
];

/** The Task screen is reached from a task, never from the navigation. */
export const taskPath = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}`;

export function screenForPath(pathname: string): ScreenLink | undefined {
  if (pathname === '/') return screens[0];
  return screens.find((screen) => screen.path !== '/' && pathname.startsWith(screen.path));
}
