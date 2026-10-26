import { agentSchema, runDetailsSchema, runSchema } from '@megalodon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { workKeys } from './work';

export const runKeys = {
  all: ['runs'] as const,
  forTask: (taskId: string) => ['runs', 'task', taskId] as const,
  run: (id: string) => ['runs', id] as const,
  agents: ['agents'] as const,
};

export const useAgents = () => useQuery({ queryKey: runKeys.agents, queryFn: () => api('/api/agents', agentSchema.array()) });

export const useTaskRuns = (taskId: string) =>
  useQuery({ queryKey: runKeys.forTask(taskId), queryFn: () => api(`/api/tasks/${taskId}/runs`, runSchema.array()) });

export const useRun = (id: string) => useQuery({ queryKey: runKeys.run(id), queryFn: () => api(`/api/runs/${id}`, runDetailsSchema) });

function useInvalidateRuns() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: runKeys.all }),
      client.invalidateQueries({ queryKey: workKeys.all }),
      client.invalidateQueries({ queryKey: workKeys.tasks }),
    ]);
}

export function useStartRun(taskId: string) {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: (agentId: string) => api(`/api/tasks/${taskId}/runs`, runSchema, { method: 'POST', body: { agentId } }),
    onSuccess: invalidate,
  });
}

export function useStopRun(runId: string) {
  const invalidate = useInvalidateRuns();
  return useMutation({
    mutationFn: () => api(`/api/runs/${runId}/stop`, runSchema, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
