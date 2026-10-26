import { sendChatBodySchema, type ChatView } from '@megalodon/contracts';
import type { Hono } from 'hono';
import type { ChatService } from '../chat/service';
import { readBody } from './body';

export function chatRoutes(app: Hono, chat: ChatService): void {
  app.get('/api/chat', (c) => c.json<ChatView>(chat.view()));
  app.post('/api/chat/messages', async (c) => {
    const { text, context } = await readBody(c, sendChatBodySchema);
    return c.json<ChatView>(chat.send(text, context), 202);
  });
  app.post('/api/chat/new', (c) => c.json<ChatView>(chat.reset()));
}
