import { needsYouSchema } from '@megalodon/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const needsYouKeys = { all: ['needs-you'] as const };

export const useNeedsYou = () => useQuery({ queryKey: needsYouKeys.all, queryFn: () => api('/api/needs-you', needsYouSchema) });
