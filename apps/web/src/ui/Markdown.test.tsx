import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('escapes raw HTML in paragraphs', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
  });

  it('escapes HTML in code blocks, inline code and list items', () => {
    const out = html('```html\n<script>x</script>\n```\n\n`<b>` and\n- <i>a</i>');
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('&lt;i&gt;a&lt;/i&gt;');
    expect(out).not.toMatch(/<(script|b|i)>/);
  });

  it('renders marks, code blocks and lists', () => {
    expect(html('**a** *b* `c`')).toMatch(/<strong[^>]*>a<\/strong> <em>b<\/em> <code[^>]*>c<\/code>/);
    expect(html('```ts\nconst x = 1;\n```')).toMatch(/<pre[^>]*><code data-language="ts">const x = 1;<\/code><\/pre>/);
    expect(html('1. a')).toContain('<ol start="1"');
    expect(html('- a')).toContain('<ul');
  });
});
