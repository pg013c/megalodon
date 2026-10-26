import { z } from 'zod';

// Output contracts agents can be held to (ADR-0005). An agent names one in its front matter;
// the runtime asks the model for exactly this shape and Megalodon validates it.

export const planOutputSchema = z.object({
  summary: z.string().describe('What will change and why, in two or three sentences.'),
  steps: z.array(z.string()).describe('Ordered implementation steps, each concrete enough to act on.'),
  touches: z.array(z.string()).describe('Files, modules or contracts the change is expected to touch.'),
  risks: z.array(z.string()).describe('What could go wrong or needs care.'),
});
export type PlanOutput = z.infer<typeof planOutputSchema>;

export const reviewFindingSchema = z.object({
  severity: z.enum(['blocker', 'major', 'minor']),
  file: z.string().nullable(),
  message: z.string(),
});

export const reviewOutputSchema = z.object({
  verdict: z.enum(['approve', 'request_changes']),
  score: z.number().int().min(0).max(10).describe('0 = unusable, 10 = ready to merge as is.'),
  summary: z.string(),
  findings: z.array(reviewFindingSchema),
});
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

export const triageOutputSchema = z.object({
  summary: z.string().describe('What the task really involves, in two or three sentences.'),
  touches: z.array(z.string()).describe('Directories or files the change will touch, as repository paths; globs allowed.'),
  pipeline: z.string().describe('Id of the pipeline that fits the task.'),
  dependsOn: z
    .array(z.object({ number: z.number().int().positive(), reason: z.string() }))
    .describe('Other tasks or stories (by #number) whose code must be merged first.'),
  manualTasks: z
    .array(z.object({ title: z.string(), description: z.string(), reason: z.string() }))
    .describe('Work only the operator can do before this task can start: accounts, keys, service configuration.'),
});
export type TriageOutput = z.infer<typeof triageOutputSchema>;

export const outputContracts = {
  plan: planOutputSchema,
  review: reviewOutputSchema,
  triage: triageOutputSchema,
} as const;
export type OutputContract = keyof typeof outputContracts;
export const outputContractSchema = z.enum(['plan', 'review', 'triage']);
