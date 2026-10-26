import { storedEventSchema, type StoredEvent } from '@megalodon/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { keys } from './projects';
import { runKeys } from './runs';
import { workKeys } from './work';

/** Query keys that an event type makes stale. Transcript messages update views directly instead. */
export function staleKeys(type: string): readonly (readonly string[])[] {
  if (type.startsWith('project.') || type.startsWith('workspace.')) return [keys.projects, keys.workspace];
  if (type.startsWith('task.') || type.startsWith('story.')) return [workKeys.all, workKeys.tasks];
  if (type === 'step.message') return [];
  if (type.startsWith('run.') || type.startsWith('step.')) return [runKeys.all];
  return [];
}

type Listener = (event: StoredEvent) => void;
const listeners = new Set<Listener>();

/** Hears every event from the stream, e.g. to append transcript lines as they arrive. */
export function useEventListener(listener: Listener): void {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}

/** Keeps cached queries in step with the server's event stream (ADR-0022). */
export function useLiveUpdates(): void {
  const client = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.addEventListener('event', (message) => {
      const parsed = storedEventSchema.safeParse(JSON.parse((message as MessageEvent<string>).data));
      if (!parsed.success) return;
      for (const queryKey of staleKeys(parsed.data.type)) void client.invalidateQueries({ queryKey });
      for (const listener of listeners) listener(parsed.data);
    });
    return () => source.close();
  }, [client]);
}
