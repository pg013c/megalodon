import { randomUUID } from 'node:crypto';
import { decisionEvents, runStream, taskStream, type Actor, type Decision, type NewEvent } from '@megalodon/contracts';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import type { DecisionsQueries } from './projection';

export interface DecisionInput {
  taskId: string;
  runId: string | null;
  stepId: string | null;
  kind: string;
  outcome: string;
  rationale: string;
  alternatives: string[];
  inputs?: Record<string, unknown>;
  actor: Actor;
}

/** Records decisions and lets the operator override them (CONCEPTS.md §7). */
export class DecisionService {
  constructor(
    private readonly store: EventStore,
    readonly queries: DecisionsQueries,
  ) {}

  /** The event for a decision, to append together with what it causes. */
  event(input: DecisionInput, overrides: string | null = null): NewEvent {
    const { actor, inputs = {}, ...rest } = input;
    return {
      type: decisionEvents.made,
      stream: input.runId ? runStream(input.runId) : taskStream(input.taskId),
      data: { id: randomUUID(), ...rest, inputs, overrides },
      actor,
    };
  }

  /** The operator picks another of the decision's alternatives; the new decision supersedes it. */
  override(id: string, outcome: string, rationale: string): Decision {
    const decision = this.get(id);
    if (decision.supersededBy) throw new AppError(409, 'DECISION_SUPERSEDED', 'A later decision already replaced this one');
    if (outcome === decision.outcome) throw new AppError(409, 'SAME_OUTCOME', `The decision already is "${outcome}"`);
    if (!decision.alternatives.includes(outcome)) {
      throw new AppError(400, 'NOT_AN_ALTERNATIVE', `"${outcome}" is not one of: ${decision.alternatives.join(', ')}`);
    }
    const [event] = this.store.append([
      this.event(
        {
          taskId: decision.taskId,
          runId: decision.runId,
          stepId: decision.stepId,
          kind: decision.kind,
          outcome,
          rationale,
          alternatives: decision.alternatives,
          inputs: decision.inputs,
          actor: { kind: 'operator' },
        },
        decision.id,
      ),
    ]);
    return this.get((event!.data as { id: string }).id);
  }

  private get(id: string): Decision {
    const decision = this.queries.get(id);
    if (!decision) throw new AppError(404, 'DECISION_NOT_FOUND', `No decision ${id}`);
    return decision;
  }
}
