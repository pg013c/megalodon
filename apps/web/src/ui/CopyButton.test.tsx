import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  it('renders a plain button with its label', () => {
    const out = renderToStaticMarkup(<CopyButton text="megalodon/3-x" label="Copy branch" />);
    expect(out).toContain('Copy branch');
    expect(out).toContain('type="button"');
  });
});
