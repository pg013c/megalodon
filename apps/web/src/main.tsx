import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Library, NeedsYou, NotFound, Task } from './screens';
import { Overview } from './screens/Overview';
import { ProjectBoard } from './screens/project/ProjectBoard';
import { ProjectBranches } from './screens/project/ProjectBranches';
import { ProjectLayout } from './screens/project/ProjectLayout';
import { ProjectSettingsScreen } from './screens/project/ProjectSettings';
import { Layout } from './shell/Layout';
import { UiStateProvider } from './shell/UiState';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } },
});

const router = createBrowserRouter([
  {
    element: (
      <UiStateProvider>
        <Layout />
      </UiStateProvider>
    ),
    children: [
      { path: '/', element: <Overview /> },
      {
        path: '/project',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <ProjectBoard /> },
          { path: 'branches', element: <ProjectBranches /> },
          { path: 'settings', element: <ProjectSettingsScreen /> },
        ],
      },
      { path: '/needs-you', element: <NeedsYou /> },
      { path: '/library/*', element: <Library /> },
      { path: '/tasks/:taskId', element: <Task /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
