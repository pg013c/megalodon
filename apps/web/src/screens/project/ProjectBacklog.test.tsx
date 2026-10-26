import type { Story } from '@megalodon/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoryList } from './ProjectBacklog';

const story = (number: number, title: string, status: Story['status'], doneCount: number, taskCount: number): Story => ({
  id: `s${number}`,
  projectId: 'p',
  number,
  title,
  description: '',
  status,
  taskCount,
  doneCount,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('StoryList', () => {
  it('shows each story with its number, title, status and progress', () => {
    const out = renderToStaticMarkup(
      <StoryList stories={[story(1, 'Sign-in flow', 'needs_you', 1, 3), story(4, 'Billing', 'done', 2, 2)]} onOpen={() => {}} />,
    );
    expect(out).toContain('#1');
    expect(out).toContain('Sign-in flow');
    expect(out).toContain('Needs you');
    expect(out).toContain('1/3');
    expect(out).toContain('#4');
    expect(out).toContain('Done');
    expect(out).toContain('2/2');
  });
});
