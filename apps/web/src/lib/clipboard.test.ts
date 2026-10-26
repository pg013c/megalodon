import { describe, expect, it } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  it('writes the exact text and reports success', async () => {
    let seen: string | undefined;
    const ok = await copyText('megalodon/3-x', { writeText: async (t) => { seen = t; } });
    expect(ok).toBe(true);
    expect(seen).toBe('megalodon/3-x');
  });

  it('reports failure when the write is rejected', async () => {
    const ok = await copyText('x', { writeText: () => Promise.reject(new Error('denied')) });
    expect(ok).toBe(false);
  });

  it('reports failure when there is no clipboard', async () => {
    expect(await copyText('x', undefined)).toBe(false);
  });
});
