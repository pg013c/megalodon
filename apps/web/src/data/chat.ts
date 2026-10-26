import { chatViewSchema, type ChatContext } from '@megalodon/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const chatKeys = { all: ['chat'] as const };

export const useChat = () => useQuery({ queryKey: chatKeys.all, queryFn: () => api('/api/chat', chatViewSchema) });

export function useChatActions() {
  const client = useQueryClient();
  const update = (view: unknown) => client.setQueryData(chatKeys.all, chatViewSchema.parse(view));
  const send = useMutation({
    mutationFn: (input: { text: string; context: ChatContext }) => api('/api/chat/messages', chatViewSchema, { method: 'POST', body: input }),
    onSuccess: update,
  });
  const reset = useMutation({ mutationFn: () => api('/api/chat/new', chatViewSchema, { method: 'POST' }), onSuccess: update });
  return { send, reset };
}
