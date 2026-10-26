import { healthSchema } from '@megalodon/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const healthKeys = { all: ['health'] as const };

// version and release do not change while the server runs, so this is never refetched
export const useHealth = (enabled = true) =>
  useQuery({ queryKey: healthKeys.all, queryFn: () => api('/api/health', healthSchema), enabled, staleTime: Infinity });
