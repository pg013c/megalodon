import type { AgentScore, PipelineScore } from '@megalodon/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cost } from '../../lib/format';
import { AgentScoreTable, PipelineScoreTable, ScorecardTables } from './ScorecardView';

const agentScore = (agentId: string, agentVersion: string, current: boolean, more: Partial<AgentScore> = {}): AgentScore => ({
  agentId,
  agentVersion,
  name: agentId === 'implementer' ? 'Implementer' : 'Reviewer',
  current,
  runs: 4,
  steps: 5,
  succeeded: 3,
  successRate: 0.75,
  rework: 1,
  reviewed: 2,
  reviewScore: 7.5,
  costUsd: 1.234,
  avgCostUsd: 0.25,
  avgDurationMs: 134_000,
  decisions: 0,
  overridden: 0,
  ...more,
});

const pipelineScore: PipelineScore = {
  pipelineId: 'feature',
  pipelineVersion: 'f0f0f0f0f0f0',
  name: 'Feature',
  current: true,
  runs: 3,
  finished: 3,
  merged: 2,
  mergedUnattended: 2,
  unattendedRate: 2 / 3,
  avgAttempts: 1.5,
  costUsd: 0.9,
  avgCostUsd: 0.3,
  avgDurationMs: 60_000,
};

describe('AgentScoreTable', () => {
  it('puts the versions of an agent next to each other, the current one flagged', () => {
    const out = renderToStaticMarkup(
      <AgentScoreTable
        agents={[
          agentScore('implementer', 'aaaaaaa1111', true),
          agentScore('implementer', 'bbbbbbb2222', false, { successRate: 0.5, costUsd: 2.5 }),
          agentScore('reviewer', 'ccccccc3333', true, { decisions: 4, overridden: 1 }),
        ]}
        onOpen={() => {}}
      />,
    );
    expect(out).toContain('vaaaaaaa');
    expect(out).toContain('vbbbbbbb');
    expect(out).not.toContain('aaaaaaa1');
    expect(out.match(/Current/g)).toHaveLength(2);
    expect(out).toContain('75%');
    expect(out).toContain('50%');
    expect(out).toContain(cost(1.234));
    expect(out).toContain(cost(2.5));
    expect(out).toContain('7.5');
    expect(out).toContain('1 / 4');
    expect(out.indexOf('vbbbbbbb')).toBeLessThan(out.indexOf('Reviewer'));
    expect(out.indexOf('Implementer')).toBeLessThan(out.indexOf('vaaaaaaa'));
  });

  it('names an agent no longer in the library by its id', () => {
    const out = renderToStaticMarkup(<AgentScoreTable agents={[agentScore('gone', 'ddddddd', false, { name: null })]} onOpen={() => {}} />);
    expect(out).toContain('gone');
    expect(out).toContain('removed from library');
  });
});

describe('PipelineScoreTable', () => {
  it('shows runs, merges and the unattended rate', () => {
    const out = renderToStaticMarkup(<PipelineScoreTable pipelines={[pipelineScore]} onOpen={() => {}} />);
    expect(out).toContain('Feature');
    expect(out).toContain('vf0f0f0f');
    expect(out).toContain('67%');
    expect(out).toContain('2 of 3');
    expect(out).toContain('1.5');
    expect(out).toContain(cost(0.9));
  });
});

describe('ScorecardTables', () => {
  it('shows an empty state when the period has no data', () => {
    const out = renderToStaticMarkup(
      <ScorecardTables card={{ period: '24h', projectId: null, agents: [], pipelines: [] }} onOpen={() => {}} hint="Pick a longer period." />,
    );
    expect(out).toContain('No runs in this period');
    expect(out).toContain('Pick a longer period.');
  });
});
