import { describe, expect, it } from 'vitest';
import { newEventSchema } from './events';

describe('newEventSchema', () => {
  it('accepts an agent actor with its version', () => {
    const event = {
      type: 'decision.made',
      stream: 'task:1',
      data: { choice: 'x' },
      actor: { kind: 'agent', agentId: 'triage', version: 'abc123' },
    };
    expect(newEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an agent actor without a version', () => {
    const result = newEventSchema.safeParse({
      type: 'decision.made',
      stream: 'task:1',
      data: null,
      actor: { kind: 'agent', agentId: 'triage' },
    });
    expect(result.success).toBe(false);
  });
});
