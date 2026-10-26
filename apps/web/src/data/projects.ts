import {
  branchDiffSchema,
  branchSchema,
  filePatchSchema,
  projectSchema,
  workspaceSchema,
  type Project,
  type ProjectSettings,
} from '@megalodon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './api';

export const keys = {
  projects: ['projects'] as const,
  workspace: ['workspace'] as const,
  branches: (id: string) => ['projects', id, 'branches'] as const,
  diff: (id: string, branch: string) => ['projects', id, 'diff', branch] as const,
  patch: (id: string, branch: string, file: string) => ['projects', id, 'diff', branch, file] as const,
};

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => api('/api/projects', projectSchema.array()) });

export const useWorkspace = () =>
  useQuery({ queryKey: keys.workspace, queryFn: () => api('/api/workspace', workspaceSchema) });

/** The active project, or null when none is set; undefined while loading. */
export function useActiveProject(): Project | null | undefined {
  const projects = useProjects();
  const workspace = useWorkspace();
  if (!projects.data || !workspace.data) return undefined;
  return projects.data.find((p) => p.id === workspace.data.activeProjectId) ?? null;
}

function useInvalidateProjects() {
  const client = useQueryClient();
  return () => Promise.all([client.invalidateQueries({ queryKey: keys.projects }), client.invalidateQueries({ queryKey: keys.workspace })]);
}

export function useConnectProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (path: string) => api('/api/projects', projectSchema, { method: 'POST', body: { path } }),
    onSuccess: invalidate,
  });
}

export function useSetActiveProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (projectId: string | null) =>
      api('/api/workspace/active-project', workspaceSchema, { method: 'PUT', body: { projectId } }),
    onSuccess: invalidate,
  });
}

export function useUpdateSettings(id: string) {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (settings: ProjectSettings) =>
      api(`/api/projects/${id}/settings`, projectSchema, { method: 'PUT', body: { settings } }),
    onSuccess: invalidate,
  });
}

export function useDisconnectProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export const useBranches = (id: string) =>
  useQuery({ queryKey: keys.branches(id), queryFn: () => api(`/api/projects/${id}/branches`, branchSchema.array()) });

export function useFetchBranches(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/projects/${id}/fetch`, branchSchema.array(), { method: 'POST' }),
    onSuccess: (branches) => client.setQueryData(keys.branches(id), branches),
  });
}

export const useBranchDiff = (id: string, branch: string | null) =>
  useQuery({
    queryKey: keys.diff(id, branch ?? ''),
    queryFn: () => api(`/api/projects/${id}/diff?branch=${encodeURIComponent(branch!)}`, branchDiffSchema),
    enabled: branch !== null,
  });

export const useFilePatch = (id: string, branch: string, file: string | null) =>
  useQuery({
    queryKey: keys.patch(id, branch, file ?? ''),
    queryFn: () =>
      api(`/api/projects/${id}/diff?branch=${encodeURIComponent(branch)}&file=${encodeURIComponent(file!)}`, filePatchSchema),
    enabled: file !== null,
  });
