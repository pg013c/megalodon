import {
  dependencySchema,
  projectWorkSchema,
  storySchema,
  taskDetailsSchema,
  taskSchema,
  type TaskKind,
} from '@megalodon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
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

export type TaskAction = 'cancel' | 'complete' | 'reopen' | 'queue' | 'retry' | 'front' | 'triage';

export function useTaskAction(id: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ action, reason }: { action: TaskAction; reason?: string }) =>
      api(`/api/tasks/${id}/${action}`, taskSchema, { method: 'POST', body: reason ? { reason } : {} }),
    onSuccess: invalidate,
  });
}

export function useAddDependency(taskId: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (
      input:
        | { kind: 'code'; target: { type: 'task' | 'story'; id: string } }
        | { kind: 'manual'; target: { type: 'task'; id: string } }
        | { kind: 'external'; description: string; command: string | null },
    ) => api(`/api/tasks/${taskId}/dependencies`, dependencySchema, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDependencyAction() {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'remove' | 'met' }) =>
      action === 'remove'
        ? api(`/api/dependencies/${id}`, z.undefined(), { method: 'DELETE' })
        : api(`/api/dependencies/${id}/met`, dependencySchema, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useSetTouches(taskId: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (touches: string[]) => api(`/api/tasks/${taskId}/touches`, taskSchema, { method: 'PUT', body: { touches } }),
    onSuccess: invalidate,
  });
}

export function useSetPipeline(taskId: string) {
  const invalidate = useInvalidateWork();
  return useMutation({
    mutationFn: (pipelineId: string) => api(`/api/tasks/${taskId}/pipeline`, taskSchema, { method: 'PUT', body: { pipelineId } }),
    onSuccess: invalidate,
  });
}
