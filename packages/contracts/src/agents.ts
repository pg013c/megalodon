import { z } from 'zod';
import { outputContractSchema } from './outputs';

/** Built-in tools of the Claude runtime an agent may be given (ADR-0024). */
export const builtinTools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'] as const;

export const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

export const mcpServerSchema = z.union([
  z.object({ type: z.literal('stdio').default('stdio'), command: z.string(), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).optional() }),
  z.object({ type: z.literal('http'), url: z.url(), headers: z.record(z.string(), z.string()).optional() }),
]);

/** The front matter of an agent file; the Markdown body is the agent's persona and instructions. */
export const agentFrontMatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(''),
    model: z.string().min(1).default('claude-opus-5-5'),
    effort: effortSchema.optional(),
    /** Built-in tool names, or `mcp__<server>` for every tool of a configured MCP server. */
    tools: z.array(z.string()).default([]),
    mcpServers: z.record(z.string(), mcpServerSchema).default({}),
    maxTurns: z.number().int().positive().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    /** The output contract the agent must answer with (`outputs.ts`). */
    output: outputContractSchema.optional(),
  })
  .superRefine((agent, ctx) => {
    for (const tool of agent.tools) {
      const server = tool.startsWith('mcp__') ? (tool.slice(5).split('__')[0] ?? '') : null;
      if (server !== null ? !(server in agent.mcpServers) : !(builtinTools as readonly string[]).includes(tool)) {
        ctx.addIssue({ code: 'custom', path: ['tools'], message: `Unknown tool "${tool}"` });
      }
    }
  });

export const agentSchema = z.object({
  /** The file name without `.md`. */
  id: z.string(),
  name: z.string(),
  description: z.string(),
  model: z.string(),
  effort: effortSchema.optional(),
  tools: z.array(z.string()),
  mcpServers: z.record(z.string(), mcpServerSchema),
  maxTurns: z.number().optional(),
  maxBudgetUsd: z.number().optional(),
  output: outputContractSchema.optional(),
  instructions: z.string(),
  /** `builtin`: shipped in the repository; `library`: the operator's own, which wins on the same id. */
  source: z.enum(['builtin', 'library']),
  /** Content hash of the file; every run records the version it used (ADR-0005). */
  version: z.string(),
});
export type Agent = z.infer<typeof agentSchema>;
