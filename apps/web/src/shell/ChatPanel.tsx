import type { ChatMessage } from '@megalodon/contracts';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation } from 'react-router';
import { useChat, useChatActions } from '../data/chat';
import { useActiveProject } from '../data/projects';
import { Button } from '../ui/Button';
import { ErrorText } from '../ui/Field';
import { Markdown } from '../ui/Markdown';
import { useUiState } from './UiState';

/** The open item, read from the address: /tasks/:id or /runs/:id. */
function useOpenItem() {
  const { pathname } = useLocation();
  const task = /^\/tasks\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const run = /^\/runs\/([^/]+)/.exec(pathname)?.[1] ?? null;
  return { taskId: task ? decodeURIComponent(task) : null, runId: run };
}

/** The assistant beside every screen (PRD FR-17); it knows the active project and the open item. */
export function ChatPanel() {
  const { chatOpen, setChatOpen } = useUiState();
  const chat = useChat();
  const { send, reset } = useChatActions();
  const project = useActiveProject();
  const open = useOpenItem();
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const messages = chat.data?.messages ?? [];
  const busy = chat.data?.busy ?? false;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, chatOpen]);

  if (!chatOpen) return null;

  const submit = () => {
    if (!text.trim() || busy) return;
    send.mutate(
      { text, context: { projectId: project?.id ?? null, taskId: open.taskId, runId: open.runId } },
      { onSuccess: () => setText('') },
    );
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[min(440px,100vw)] flex-col border-l border-line bg-surface shadow-2xl">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-[15px] font-semibold">Assistant</span>
        <span className="truncate text-xs text-muted">
          {project ? project.name : 'No project'}
          {open.taskId ? ' · this task' : open.runId ? ' · this run' : ''}
        </span>
        <Button variant="ghost" className="ml-auto" disabled={busy || messages.length === 0} onClick={() => reset.mutate()}>
          New chat
        </Button>
        <button type="button" onClick={() => setChatOpen(false)} className="px-1 text-xl leading-none text-muted hover:text-ink" aria-label="Close">
          ×
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-[13px] text-muted">Ask about your projects, or tell me what to do: “add tasks X, Y and Z”, “what is blocked and why?”, “approve the plan of #12”.</p>
        )}
        {messages.map((m) => (
          <Message key={m.seq} message={m} />
        ))}
        {busy && <p className="text-xs text-muted">Working…</p>}
        <div ref={bottom} />
      </div>

      <footer className="border-t border-line p-3">
        <ErrorText error={send.error ?? reset.error} />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          placeholder="Write to the assistant… (Enter sends, Shift+Enter breaks the line)"
          className="w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-accent focus:bg-surface"
        />
      </footer>
    </aside>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return <p className="ml-10 whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[13px] text-white">{message.text}</p>;
  }
  if (message.role === 'tool') {
    return (
      <p className="truncate text-xs text-muted" title={message.text}>
        ⚙ {message.tool} <span className="font-mono">{toolSummary(message.text)}</span>
      </p>
    );
  }
  return <Markdown text={message.text} className="mr-6 text-[13px] leading-5" />;
}

/** The telling argument of a tool call, e.g. the title of a created task. */
function toolSummary(input: string): string {
  try {
    const value = JSON.parse(input) as Record<string, unknown>;
    for (const key of ['title', 'task', 'outcome', 'text', 'projectId']) if (typeof value[key] === 'string') return String(value[key]);
  } catch {
    // clipped input
  }
  return '';
}
