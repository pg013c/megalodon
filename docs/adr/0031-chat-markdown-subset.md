# ADR-0031: A Markdown subset in the assistant's replies

Status: Accepted · Date: 2026-10-26

## Context
The assistant (ADR-0030) answers in Markdown, but the chat panel showed its replies as plain text,
so `**bold**`, lists and code blocks appeared as raw syntax. A full Markdown library would bring
far more than a chat needs and, with raw HTML enabled, a way to inject markup into the app.

## Decision
- Assistant replies render a **Markdown subset**: paragraphs with their line breaks, fenced code
  blocks (``` with an optional language, monospaced, no highlighting), unordered and ordered
  lists, bold, italic and inline code, with backslash escapes.
- **In-house, no dependency:** a pure parser (`apps/web/src/lib/markdown.ts`) turns text into a
  small block/inline tree, and a React component (`apps/web/src/ui/Markdown.tsx`) renders it.
- **Raw HTML is text.** Every piece of text reaches React as a string child, so React escapes it;
  `dangerouslySetInnerHTML` is never used.
- Malformed or unclosed markers stay plain text and never throw. An unclosed fence is text too
  (unlike CommonMark, which runs it to the end of the message).
- `_` marks need word boundaries, so `snake_case` stays literal; `*` marks need no whitespace
  inside the delimiters, so `2 * 3` stays literal.
- The operator's own messages stay plain text.

## Consequences
- Headings, links, images, block quotes and tables are not supported and show as raw text; nested
  lists are flattened into one level.
- Adding links later must check URL schemes (no `javascript:`); the escaping tests guard the rest.
- Some glob-like text outside backticks (e.g. `*.ts,*.tsx`) may still turn italic.
