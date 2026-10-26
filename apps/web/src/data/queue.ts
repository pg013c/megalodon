import { queueViewSchema, schedulerStateSchema } from '@megalodon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const queueKeys = { queue: ['queue'] as const };

export const useQueue = () => useQuery({ queryKey: queueKeys.queue, queryFn: () => api('/api/queue', queueViewSchema) });

export function useQueueControl() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: { type: 'slots'; slots: number } | { type: 'pause' } | { type: 'resume' }) =>
      action.type === 'slots'
        ? api('/api/queue/slots', schedulerStateSchema, { method: 'PUT', body: { slots: action.slots } })
        : api(`/api/queue/${action.type}`, schedulerStateSchema, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: queueKeys.queue }),
  });
}
