import { z } from 'zod';

const stepId = z.string().regex(/^[a-z][a-z0-9-]*$/, 'Step ids are lowercase words joined by dashes');

/** Go back to an earlier step when this one fails; `max: project` uses the project's fix passes. */
export const onFailSchema = z.object({
  retry: stepId,
  max: z.union([z.number().int().min(0).max(10), z.literal('project')]).default('project'),
});
export type OnFail = z.infer<typeof onFailSchema>;

/** Passes when the step's review output approves with at least this score. */
export const gateSchema = z.object({ minScore: z.number().int().min(0).max(10) });
export type Gate = z.infer<typeof gateSchema>;

export const pipelineAgentStepSchema = z.object({
  id: stepId,
  name: z.string().optional(),
  agent: z.string().min(1),
  gate: gateSchema.optional(),
  onFail: onFailSchema.optional(),
});

export const pipelineCheckStepSchema = z.object({
  id: stepId,
  name: z.string().optional(),
  /** `project`: the project's configured checks (ADR-0015). */
  check: z.literal('project'),
  onFail: onFailSchema.optional(),
});

export const pipelineFileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(''),
    steps: z.array(z.union([pipelineAgentStepSchema, pipelineCheckStepSchema])).min(1),
  })
  .superRefine((pipeline, ctx) => {
    const seen: string[] = [];
    pipeline.steps.forEach((step, i) => {
      if (seen.includes(step.id)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'id'], message: `Duplicate step "${step.id}"` });
      if (step.onFail && !seen.includes(step.onFail.retry)) {
        ctx.addIssue({ code: 'custom', path: ['steps', i, 'onFail', 'retry'], message: `"${step.onFail.retry}" is not an earlier step` });
      }
      seen.push(step.id);
    });
  });

export const pipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(z.union([pipelineAgentStepSchema, pipelineCheckStepSchema])),
  source: z.enum(['builtin', 'library']),
  version: z.string(),
});
export type Pipeline = z.infer<typeof pipelineSchema>;
