import { z } from 'zod';

/** The in-app chat (PRD FR-17, ADR-0030). */
export const chatRoleSchema = z.enum(['user', 'assistant', 'tool']);

export const chatMessageSchema = z.object({
  seq: z.number().int(),
  conversationId: z.string(),
  role: chatRoleSchema,
  text: z.string(),
  /** For `tool`: which Megalodon tool the assistant used. */
  tool: z.string().nullable(),
  at: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatViewSchema = z.object({
  conversationId: z.string().nullable(),
  busy: z.boolean(),
  messages: z.array(chatMessageSchema),
});
export type ChatView = z.infer<typeof chatViewSchema>;

/** What the operator is looking at when they write: the chat answers in that context. */
export const chatContextSchema = z.object({
  projectId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const sendChatBodySchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  context: chatContextSchema.default({ projectId: null, taskId: null, runId: null }),
});

export const chatEvents = {
  started: 'chat.started',
  message: 'chat.message',
  session: 'chat.session',
  finished: 'chat.finished',
} as const;

export const chatStream = (id: string) => `chat:${id}`;
