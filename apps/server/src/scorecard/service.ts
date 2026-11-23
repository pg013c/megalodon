import { runStatusSchema, type AgentScore, type Period, type PipelineScore, type Scorecard, type ScorecardRuns } from '@megalodon/contracts';
import type { Library } from '../library/library';
import { periodStart } from '../overview/service';
import type { ScorecardQueries } from './projection';

/** One agent version or one pipeline version. */
export type ScorecardTarget = { kind: 'agent'; id: string; version: string } | { kind: 'pipeline'; id: string; version: string };

export interface ScorecardDeps {
  queries: ScorecardQueries;
  library: Library;
  now?: () => Date;
}

interface Current {
  version: string;
  name: string;
}

const key = (id: string, version: string) => `${id}\u0000${version}`;
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** How each agent and pipeline version did (PRD FR-13, ADR-0032). */
export class ScorecardService {
  constructor(private readonly deps: ScorecardDeps) {}

  view(period: Period, projectId: string | null): Scorecard {
    const since = periodStart(period, this.deps.now?.() ?? new Date());
    const agents = new Map<string, Current>(this.deps.library.agents().map((a) => [a.id, { version: a.version, name: a.name }]));
    const pipelines = new Map<string, Current>(this.deps.library.pipelines().map((p) => [p.id, { version: p.version, name: p.name }]));
    // a single-agent run is the pipeline `agent:<id>`, at the agent's version
    for (const [id, agent] of agents) pipelines.set(`agent:${id}`, agent);

    const scores = new Map<string, AgentScore>();
    const score = (agentId: string, agentVersion: string): AgentScore => {
      const existing = scores.get(key(agentId, agentVersion));
      if (existing) return existing;
      const current = agents.get(agentId);
      const created: AgentScore = {
        agentId,
        agentVersion,
        name: current?.name ?? null,
        current: current?.version === agentVersion,
        runs: 0,
        steps: 0,
        succeeded: 0,
        successRate: null,
        rework: 0,
        reviewed: 0,
        reviewScore: null,
        costUsd: 0,
        avgCostUsd: null,
        avgDurationMs: null,
        decisions: 0,
        overridden: 0,
      };
      scores.set(key(agentId, agentVersion), created);
      return created;
    };
    for (const row of this.deps.queries.agents(projectId, since)) {
      Object.assign(score(row.agentId, row.agentVersion), {
        runs: row.runs,
        steps: row.steps,
        succeeded: row.succeeded,
        successRate: ratio(row.succeeded, row.ended),
        rework: row.rework,
        reviewed: row.reviewed,
        reviewScore: row.reviewScore,
        costUsd: row.costUsd,
        avgCostUsd: row.avgCostUsd,
        avgDurationMs: row.avgDurationMs,
      });
    }
    for (const row of this.deps.queries.decisions(projectId, since)) {
      Object.assign(score(row.agentId, row.agentVersion), { decisions: row.decisions, overridden: row.overridden });
    }

    const pipelineScores = this.deps.queries.pipelines(projectId, since).map((row): PipelineScore => {
      const current = pipelines.get(row.pipelineId);
      return {
        ...row,
        name: current?.name ?? null,
        current: current?.version === row.pipelineVersion,
        unattendedRate: ratio(row.mergedUnattended, row.finished),
      };
    });

    return {
      period,
      projectId,
      agents: [...scores.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || Number(b.current) - Number(a.current) || b.steps - a.steps || b.decisions - a.decisions),
      pipelines: pipelineScores.sort((a, b) => a.pipelineId.localeCompare(b.pipelineId) || Number(b.current) - Number(a.current) || b.runs - a.runs),
    };
  }

  /** The runs behind one row of `view`, with the same filters (ADR-0033). */
  runs(target: ScorecardTarget, period: Period, projectId: string | null): ScorecardRuns {
    const since = periodStart(period, this.deps.now?.() ?? new Date());
    const { total, runs } =
      target.kind === 'agent'
        ? this.deps.queries.agentRuns(target.id, target.version, projectId, since)
        : this.deps.queries.pipelineRuns(target.id, target.version, projectId, since);
    return { total, runs: runs.map((r) => ({ ...r, status: runStatusSchema.parse(r.status), merged: r.merged === 1 })) };
  }
}
