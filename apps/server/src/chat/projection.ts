import { chatEvents, type ChatMessage, type StoredEvent } from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** Chat conversations and their messages (tables from migration 9). */
export class ChatProjection implements Projection {
  readonly name = 'chat';

  reset(db: Database): void {
    db.exec('DELETE FROM chat_messages; DELETE FROM chat_conversations;');
  }

  apply(db: Database, event: StoredEvent): void {
    const data = event.data as { conversationId: string; role?: string; text?: string; tool?: string | null; sessionId?: string };
    switch (event.type) {
      case chatEvents.started:
        db.prepare('INSERT INTO chat_conversations (id, created_seq) VALUES (?, ?)').run(data.conversationId, event.seq);
        return;
      case chatEvents.message:
        db.prepare('INSERT INTO chat_messages (seq, conversation_id, role, text, tool, at) VALUES (?, ?, ?, ?, ?, ?)').run(
          event.seq,
          data.conversationId,
          data.role ?? 'assistant',
          data.text ?? '',
          data.tool ?? null,
          event.at,
        );
        if (data.role === 'user') db.prepare('UPDATE chat_conversations SET busy = 1 WHERE id = ?').run(data.conversationId);
        return;
      case chatEvents.session:
        db.prepare('UPDATE chat_conversations SET session_id = ? WHERE id = ?').run(data.sessionId ?? null, data.conversationId);
        return;
      case chatEvents.finished:
        db.prepare('UPDATE chat_conversations SET busy = 0 WHERE id = ?').run(data.conversationId);
        return;
    }
  }
}

export class ChatQueries {
  constructor(private readonly db: Database) {}

  latest(): { id: string; sessionId: string | null; busy: boolean } | null {
    const row = this.db.prepare('SELECT id, session_id, busy FROM chat_conversations ORDER BY created_seq DESC LIMIT 1').get() as
      | { id: string; session_id: string | null; busy: number }
      | undefined;
    return row ? { id: row.id, sessionId: row.session_id, busy: row.busy === 1 } : null;
  }

  messages(conversationId: string): ChatMessage[] {
    const rows = this.db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY seq').all(conversationId) as {
      seq: number;
      conversation_id: string;
      role: ChatMessage['role'];
      text: string;
      tool: string | null;
      at: string;
    }[];
    return rows.map((r) => ({ seq: r.seq, conversationId: r.conversation_id, role: r.role, text: r.text, tool: r.tool, at: r.at }));
  }
}
