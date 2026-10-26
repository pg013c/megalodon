import { useMemo } from 'react';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown';

/** Markdown subset as React elements (ADR-0031); every piece of text is a string child, so React escapes it. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'code') {
    return (
      <pre className="overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-xs leading-5">
        <code data-language={block.lang ?? undefined}>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === 'list') {
    const items = block.items.map((item, i) => (
      <li key={i} className="whitespace-pre-wrap">
        <Inlines nodes={item} />
      </li>
    ));
    return block.ordered ? (
      <ol start={block.start} className="list-decimal space-y-0.5 pl-5">
        {items}
      </ol>
    ) : (
      <ul className="list-disc space-y-0.5 pl-5">{items}</ul>
    );
  }
  return (
    <p className="whitespace-pre-wrap">
      <Inlines nodes={block.children} />
    </p>
  );
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, i) => {
    if (node.kind === 'text') return node.text;
    if (node.kind === 'code') {
      return (
        <code key={i} className="rounded bg-canvas px-1 py-0.5 font-mono text-[12px]">
          {node.text}
        </code>
      );
    }
    const children = <Inlines nodes={node.children} />;
    return node.kind === 'strong' ? (
      <strong key={i} className="font-semibold">
        {children}
      </strong>
    ) : (
      <em key={i}>{children}</em>
    );
  });
}
