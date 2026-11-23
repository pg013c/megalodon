import {
  decisionEvents,
  runEvents,
  type Decision,
  type PlannedStep,
  type Project,
  type StoredEvent,
} from '@megalodon/contracts';
import { AppError } from '../errors';
import type { Library } from '../library/library';

/**
 * The steps of a run, fixed at its start: the project's setup, then the pipeline's steps with
 * `max: project` resolved and the project's checks and test paths copied in. Refuses a pipeline
 * the project cannot run: a check it does not have, or a test guard without test paths (ADR-0034).
 */
export function buildPlan(source: { pipelineId: string } | { agentId: string }, project: Project, library: Library) {
  const setup: PlannedStep[] = project.settings.setup.length
    ? [{ kind: 'command', stepId: 'setup', name: 'Setup', commands: project.settings.setup }]
    : [];

  if ('agentId' in source) {
    const agent = library.agent(source.agentId);
    const plan: PlannedStep[] = [...setup, { kind: 'agent', stepId: 'agent', name: agent.name, agentId: agent.id, gate: null, onFail: null, tests: null, testPaths: [], commitTypes: null }];
    return { pipelineId: `agent:${agent.id}`, pipelineVersion: agent.version, plan };
  }

  const pipeline = library.pipeline(source.pipelineId);
  const steps = pipeline.steps.map((step): PlannedStep => {
    const onFail = step.onFail
      ? { retry: step.onFail.retry, max: step.onFail.max === 'project' ? project.settings.maxFixPasses : step.onFail.max }
      : null;
    if ('check' in step) {
      const name = step.name ?? 'Checks';
      const missing = (step.only ?? []).find((check) => !project.settings.checks.some((c) => c.name === check));
      if (missing) throw new AppError(400, 'CHECK_NOT_FOUND', `Step "${name}" of ${pipeline.name} runs the check "${missing}"; ${project.name} has no such check`);
      const checks = step.only ? project.settings.checks.filter((c) => step.only!.includes(c.name)) : project.settings.checks;
      // a step that expects failure needs something whose failure counts
      if (step.expect === 'fail' && !checks.some((c) => c.required)) {
        throw new AppError(400, 'CHECK_NOT_FOUND', `Step "${name}" of ${pipeline.name} needs a required check to fail; ${project.name} has none among ${step.only?.join(', ') ?? 'its checks'}`);
      }
      return { kind: 'check', stepId: step.id, name, checks, onFail, expect: step.expect };
    }
    const agent = library.agent(step.agent);
    if (step.tests && !project.settings.testPaths.length) {
      throw new AppError(400, 'NO_TEST_PATHS', `${pipeline.name} needs the project's test paths; set them in the project settings`);
    }
    return {
      kind: 'agent',
      stepId: step.id,
      name: step.name ?? agent.name,
      agentId: agent.id,
      gate: step.gate ?? null,
      onFail,
      tests: step.tests ?? null,
      testPaths: step.tests ? project.settings.testPaths : [],
      commitTypes: step.commitTypes ?? null,
    };
  });
  return { pipelineId: pipeline.id, pipelineVersion: pipeline.version, plan: [...setup, ...steps] };
}

/** Where a run stands, replayed from its events; used to continue it, also after a restart. */
export interface RunPosition {
  /** The plan index of the next step to run. */
  index: number;
  /** An attempt that started and did not finish. */
  inProgress: { stepId: string; attempt: number; sessionId: string | null } | null;
  attempts: Map<string, number>;
  /** Retries used, per step whose `onFail` rule spent them. */
  retries: Map<string, number>;
  /** The latest structured output of each step. */
  outputs: Map<string, unknown>;
  /** The latest session of each agent step, to continue it on a retry. */
  sessions: Map<string, string>;
  /** Why the step about to run is a retry, if it is. */
  feedback: string | null;
  /** The latest report of each check step. */
  reports: Map<string, string>;
  /** The latest base of each step guarded by test paths, as its attempt recorded it. */
  bases: Map<string, string>;
  /** When the step about to run retries itself: the base of its failed attempt, kept for this one. */
  retryBase: string | null;
}

export function runPosition(events: readonly StoredEvent[], plan: readonly PlannedStep[]): RunPosition {
  const indexOf = (stepId: string) => plan.findIndex((s) => s.stepId === stepId);
  const position: RunPosition = {
    index: 0,
    inProgress: null,
    attempts: new Map(),
    retries: new Map(),
    outputs: new Map(),
    sessions: new Map(),
    feedback: null,
    reports: new Map(),
    bases: new Map(),
    retryBase: null,
  };
  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    if (event.type === runEvents.stepStarted) {
      const stepId = String(data.stepId);
      const attempt = Number(data.attempt ?? 1);
      position.index = indexOf(stepId);
      position.attempts.set(stepId, attempt);
      position.inProgress = { stepId, attempt, sessionId: null };
      if (typeof data.base === 'string') position.bases.set(stepId, data.base);
      position.retryBase = null;
    } else if (event.type === runEvents.stepSession) {
      position.sessions.set(String(data.stepId), String(data.sessionId));
      const current = position.inProgress;
      if (current && current.stepId === data.stepId) current.sessionId = String(data.sessionId);
    } else if (event.type === runEvents.stepCompleted) {
      const stepId = String(data.stepId);
      position.inProgress = null;
      if (data.output !== undefined) position.outputs.set(stepId, data.output);
      if (plan[indexOf(stepId)]?.kind === 'check' && typeof data.result === 'string') position.reports.set(stepId, data.result);
      // a failed check or a failed gate is followed, in the same append, by a retry or the end
      if (data.status === 'succeeded') {
        position.index = indexOf(stepId) + 1;
        if (position.feedback && plan[indexOf(stepId)]?.kind === 'agent') position.feedback = null;
      }
    } else if (event.type === decisionEvents.made) {
      const decision = data as unknown as Decision;
      if (decision.kind === 'retry' && decision.outcome.startsWith('retry') && decision.stepId) {
        const next = String(decision.inputs.next);
        position.retries.set(decision.stepId, (position.retries.get(decision.stepId) ?? 0) + 1);
        position.index = indexOf(next);
        position.feedback = typeof decision.inputs.feedback === 'string' ? decision.inputs.feedback : null;
        position.retryBase = decision.stepId === next ? (position.bases.get(next) ?? null) : null;
      }
    }
  }
  return position;
}
