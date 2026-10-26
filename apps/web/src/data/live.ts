import { storedEventSchema } from '@megalodon/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { keys } from './projects';
import { workKeys } from './work';

/** Query keys that an event type makes stale. */
export function staleKeys(type: string): readonly (readonly string[])[] {
  if (type.startsWith('project.') || type.startsWith('workspace.')) return [keys.projects, keys.workspace];
  if (type.startsWith('task.') || type.startsWith('story.')) return [workKeys.all, workKeys.tasks];
  return [];
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
    });
    return () => source.close();
  }, [client]);
}
