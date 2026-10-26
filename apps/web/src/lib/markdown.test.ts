import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, type Inline } from './markdown';

const t = (text: string): Inline => ({ kind: 'text', text });
const strong = (...children: Inline[]): Inline => ({ kind: 'strong', children });
const em = (...children: Inline[]): Inline => ({ kind: 'em', children });
const code = (text: string): Inline => ({ kind: 'code', text });
const p = (...children: Inline[]) => ({ kind: 'paragraph', children });

describe('parseMarkdown blocks', () => {
  it('gives nothing for empty text', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });

  it('keeps line breaks inside a paragraph and splits paragraphs on blank lines', () => {
    expect(parseMarkdown('hello')).toEqual([p(t('hello'))]);
    expect(parseMarkdown('one\ntwo')).toEqual([p(t('one\ntwo'))]);
    expect(parseMarkdown('one\r\n\r\ntwo')).toEqual([p(t('one')), p(t('two'))]);
  });

  it('keeps fenced code verbatim, with and without a language', () => {
    const body = '**x**\n- item\n<b>\n`y`';
    expect(parseMarkdown('```ts\n' + body + '\n```')).toEqual([{ kind: 'code', lang: 'ts', text: body }]);
    expect(parseMarkdown('before\n```\n' + body + '\n```\nafter')).toEqual([
      p(t('before')),
      { kind: 'code', lang: null, text: body },
      p(t('after')),
    ]);
  });

  it('closes a fence only with at least as many backticks', () => {
    expect(parseMarkdown('````\n```\n````')).toEqual([{ kind: 'code', lang: null, text: '```' }]);
  });

  it('parses unordered lists with -, * and +', () => {
    expect(parseMarkdown('- a\n* b\n+ c')).toEqual([{ kind: 'list', ordered: false, start: 1, items: [[t('a')], [t('b')], [t('c')]] }]);
  });

  it('parses ordered lists starting at the first number', () => {
    expect(parseMarkdown('3. a\n4) b')).toEqual([{ kind: 'list', ordered: true, start: 3, items: [[t('a')], [t('b')]] }]);
  });

  it('starts a new list when the kind changes', () => {
    expect(parseMarkdown('- a\n1. b')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [[t('a')]] },
      { kind: 'list', ordered: true, start: 1, items: [[t('b')]] },
    ]);
  });

  it('parses marks inside list items', () => {
    expect(parseMarkdown('- **bold** and *em* and `code`')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [[strong(t('bold')), t(' and '), em(t('em')), t(' and '), code('code')]] },
    ]);
  });

  it('ends a list at a blank line and continues items on the next line', () => {
    expect(parseMarkdown('Steps:\n- a\n  more\n- b\n\nDone.')).toEqual([
      p(t('Steps:')),
      { kind: 'list', ordered: false, start: 1, items: [[t('a\nmore')], [t('b')]] },
      p(t('Done.')),
    ]);
  });

  it('flattens nested items into one list', () => {
    expect(parseMarkdown('- a\n  - b')).toEqual([{ kind: 'list', ordered: false, start: 1, items: [[t('a')], [t('b')]] }]);
  });

  it('treats an unclosed fence as text and parses what follows', () => {
    expect(parseMarkdown('```\n- a')).toEqual([p(t('```')), { kind: 'list', ordered: false, start: 1, items: [[t('a')]] }]);
  });

  it('leaves unsupported constructs as text', () => {
    expect(parseMarkdown('# Title\n> quote')).toEqual([p(t('# Title\n> quote'))]);
  });
});

describe('parseInline', () => {
  it('parses bold and italic with both delimiters', () => {
    expect(parseInline('a **b** c')).toEqual([t('a '), strong(t('b')), t(' c')]);
    expect(parseInline('__b__')).toEqual([strong(t('b'))]);
    expect(parseInline('*i* and _i_')).toEqual([em(t('i')), t(' and '), em(t('i'))]);
  });

  it('nests marks', () => {
    expect(parseInline('**bold *em* `code`**')).toEqual([strong(t('bold '), em(t('em')), t(' '), code('code'))]);
    expect(parseInline('*a **b** c*')).toEqual([em(t('a '), strong(t('b')), t(' c'))]);
    expect(parseInline('***both***')).toEqual([strong(em(t('both')))]);
  });

  it('keeps Markdown inside code spans literal', () => {
    expect(parseInline('`**not bold**`')).toEqual([code('**not bold**')]);
    expect(parseInline('``a ` b``')).toEqual([code('a ` b')]);
    expect(parseInline('`` `x` ``')).toEqual([code('`x`')]);
  });

  it('ignores a mark closer inside a code span', () => {
    expect(parseInline('*a `b*` c*')).toEqual([em(t('a '), code('b*'), t(' c'))]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*literal\\*')).toEqual([t('*literal*')]);
    expect(parseInline('\\`x\\` \\\\ \\_y\\_')).toEqual([t('`x` \\ _y_')]);
  });

  it('degrades malformed markers to text', () => {
    for (const text of ['**unclosed', '*a', '`x', '**', '*', '_', 'snake_case_name', '2 * 3 * 4', 'a ** b', '****', '``x`']) {
      expect(parseInline(text)).toEqual([t(text)]);
    }
  });

  it('keeps common globs literal, and italicises a glob list without spaces', () => {
    expect(parseInline('src/**/*.ts')).toEqual([t('src/**/*.ts')]);
    expect(parseInline('*.ts and *.tsx')).toEqual([t('*.ts and *.tsx')]);
    expect(parseInline('*.ts,*.tsx')).toEqual([em(t('.ts,')), t('.tsx')]);
  });

  it('keeps raw HTML as text', () => {
    expect(parseInline('<b>hi</b>')).toEqual([t('<b>hi</b>')]);
  });

  it('does not throw on pathological input', () => {
    expect(() => parseMarkdown('*_`'.repeat(500) + '\n```\n' + '\\'.repeat(101))).not.toThrow();
  });
});
