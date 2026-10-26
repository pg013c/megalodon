import {
  projectWorkSchema,
  storySchema,
  taskDetailsSchema,
  taskSchema,
  type TaskKind,
} from '@megalodon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const workKeys = {
  all: ['work'] as const,
  project: (projectId: string) => ['work', projectId] as const,
  tasks: ['task'] as const,
  task: (id: string) => ['task', id] as const,
};

export const useWork = (projectId: string) =>
  useQuery({ queryKey: workKeys.project(projectId), queryFn: () => api(`/api/projects/${projectId}/work`, projectWorkSchema) });

export const useTaskDetails = (id: string | null) =>
  useQuery({ queryKey: workKeys.task(id ?? ''), queryFn: () => api(`/api/tasks/${id}`, taskDetailsSchema), enabled: id !== null });

function useInvalidateWork() {
  const client = useQueryClient();
  return () => Promise.all([client.invalidateQueries({ queryKey: workKeys.all }), client.invalidateQueries({ queryKey: workKeys.tasks })]);
}

export function useCreateStory(projectId: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (input: { title: string; description: string }) =>
      api(`/api/projects/${projectId}/stories`, storySchema, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useCreateTask(projectId: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (input: { kind: TaskKind; storyId: string | null; title: string; description: string }) =>
      api(`/api/projects/${projectId}/tasks`, taskSchema, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateTask(id: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (input: { title?: string; description?: string; storyId?: string | null }) =>
      api(`/api/tasks/${id}`, taskSchema, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export type TaskAction = 'cancel' | 'complete' | 'reopen';

export function useTaskAction(id: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ action, reason }: { action: TaskAction; reason?: string }) =>
      api(`/api/tasks/${id}/${action}`, taskSchema, { method: 'POST', body: reason ? { reason } : {} }),
    onSuccess: invalidate,
  });
}
