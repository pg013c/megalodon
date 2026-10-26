import { overviewSchema, type Period } from '@megalodon/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const overviewKeys = { all: ['overview'] as const, period: (p: Period) => ['overview', p] as const };

export const useOverview = (period: Period) =>
  useQuery({ queryKey: overviewKeys.period(period), queryFn: () => api(`/api/overview?period=${period}`, overviewSchema) });
