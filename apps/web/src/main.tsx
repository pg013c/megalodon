import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './shell/Layout';
import { Library, NeedsYou, NotFound, Overview, Project, Task } from './screens';
import './styles.css';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Overview /> },
      { path: '/project/*', element: <Project /> },
      { path: '/needs-you', element: <NeedsYou /> },
      { path: '/library/*', element: <Library /> },
      { path: '/tasks/:taskId', element: <Task /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
