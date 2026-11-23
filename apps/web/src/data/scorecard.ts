import { scorecardRunsSchema, scorecardSchema, type Period } from '@megalodon/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** One agent version or one pipeline version of the scorecard. */
export type ScorecardTarget = { kind: 'agent' | 'pipeline'; id: string; version: string };

export const scorecardKeys = {
  all: ['scorecard'] as const,
  view: (period: Period, projectId: string | null) => ['scorecard', period, projectId ?? 'all'] as const,
  runs: (target: ScorecardTarget, period: Period, projectId: string | null) =>
    ['scorecard', 'runs', target.kind, target.id, target.version, period, projectId ?? 'all'] as const,
};

// ids such as `agent:implementer` need encoding
const query = (params: Record<string, string | null>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== null)).toString();

export const useScorecard = (period: Period, projectId: string | null) =>
  useQuery({
    queryKey: scorecardKeys.view(period, projectId),
    queryFn: () => api(`/api/scorecard?${query({ period, projectId })}`, scorecardSchema),
  });

export const useScorecardRuns = (target: ScorecardTarget | null, period: Period, projectId: string | null) =>
  useQuery({
    queryKey: target ? scorecardKeys.runs(target, period, projectId) : ['scorecard', 'runs', 'none'],
    queryFn: () =>
      api(
        `/api/scorecard/runs?${query({
          period,
          projectId,
          [`${target!.kind}Id`]: target!.id,
          [`${target!.kind}Version`]: target!.version,
        })}`,
        scorecardRunsSchema,
      ),
    enabled: target !== null,
  });
