/**
 * A small Markdown subset for the assistant's replies (ADR-0031): paragraphs with line breaks,
 * fenced code blocks, unordered and ordered lists, bold, italic and inline code. Everything else
 * (headings, links, quotes, tables, raw HTML) stays plain text; nested lists are flattened.
 * The result is a plain tree, rendered by `ui/Markdown.tsx` without ever producing HTML strings.
 */

export type Inline = { kind: 'text'; text: string } | { kind: 'strong' | 'em'; children: Inline[] } | { kind: 'code'; text: string };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'code'; lang: string | null; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] };

const FENCE_OPEN = /^ {0,3}(`{3,})\s*([^`\s]*)\s*$/;
const FENCE_CLOSE = /^ {0,3}(`{3,})\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;

/** Text to blocks; never throws, malformed markers stay text. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, start: list.start, items: list.items.map(parseInline) });
    paragraph = [];
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const ticks = fence[1]!.length;
      let end = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const close = FENCE_CLOSE.exec(lines[j]!);
        if (close && close[1]!.length >= ticks) {
          end = j;
          break;
        }
      }
      if (end >= 0) {
        flush();
        blocks.push({ kind: 'code', lang: fence[2] || null, text: lines.slice(i + 1, end).join('\n') });
        i = end;
        continue;
      }
      // an unclosed fence is ordinary text
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1]! : numbered![2]!);
      continue;
    }

    if (list) {
      // a continuation of the last item
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last]}\n${line.trimStart()}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

const ESCAPABLE = '\\`*_';

/** Bold, italic and inline code inside one block of text; never throws. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const push = (node: Inline) => {
    if (buffer) out.push({ kind: 'text', text: buffer });
    buffer = '';
    out.push(node);
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1]!)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      const n = runLength(text, i, ch);
      const close = findBackticks(text, i + n, n);
      if (close < 0) {
        buffer += text.slice(i, i + n);
        i += n;
        continue;
      }
      let code = text.slice(i + n, close);
      if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      push({ kind: 'code', text: code });
      i = close + n;
      continue;
    }

    if (ch === '*' || ch === '_') {
      const n = runLength(text, i, ch);
      const delim = ch.repeat(n >= 2 ? 2 : 1);
      const from = i + delim.length;
      const opens = from < text.length && !isSpace(text[from]) && (ch === '*' || !isWordChar(text[i - 1]));
      const close = opens ? findCloser(text, from, delim) : -1;
      if (close < 0) {
        buffer += text.slice(i, i + n);
        i += n;
        continue;
      }
      push({ kind: delim.length === 2 ? 'strong' : 'em', children: parseInline(text.slice(from, close)) });
      i = close + delim.length;
      continue;
    }

    buffer += ch;
    i++;
  }
  if (buffer) out.push({ kind: 'text', text: buffer });
  return out;
}

/**
 * The start of the delimiter closing a mark whose content begins at `from`, or -1. Escapes and code
 * spans are skipped; the closer must not follow whitespace, and a run longer than the delimiter
 * closes with its last characters (`***a***` is strong around em).
 */
function findCloser(text: string, from: number, delim: string): number {
  const ch = delim[0]!;
  let j = from;
  while (j < text.length) {
    const c = text[j]!;
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '`') {
      const n = runLength(text, j, c);
      const close = findBackticks(text, j + n, n);
      j = close < 0 ? j + n : close + n;
      continue;
    }
    if (c === ch) {
      const n = runLength(text, j, ch);
      const end = j + n;
      const at = end - delim.length;
      if ((n === delim.length || n >= 3) && at > from && !isSpace(text[j - 1]) && (ch === '*' || !isWordChar(text[end]))) return at;
      j = end;
      continue;
    }
    j++;
  }
  return -1;
}

/** The start of the next run of exactly `n` backticks, or -1. */
function findBackticks(text: string, from: number, n: number): number {
  let j = from;
  while (j < text.length) {
    if (text[j] !== '`') {
      j++;
      continue;
    }
    const run = runLength(text, j, '`');
    if (run === n) return j;
    j += run;
  }
  return -1;
}

function runLength(text: string, at: number, ch: string): number {
  let n = 0;
  while (text[at + n] === ch) n++;
  return n;
}

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
