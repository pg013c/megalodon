import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { useTempDir } from '../test/tempDir';
import { AgentLibrary } from './agents';

const tempDir = useTempDir();
const builtin = fileURLToPath(new URL('../../../../library', import.meta.url));

function library(files: Record<string, string>) {
  const dir = tempDir();
  mkdirSync(join(dir, 'agents'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'agents', name), content);
  return dir;
}

const agentFile = (name: string, extra = '') => `---\nname: ${name}\ntools: [Read, Edit]\n${extra}---\nBe careful.\n`;

describe('AgentLibrary', () => {
  it('loads the built-in implementer', () => {
    const agent = new AgentLibrary([{ source: 'builtin', path: builtin }]).get('implementer');
    expect(agent).toMatchObject({ name: 'Implementer', model: 'claude-opus-5-5', source: 'builtin' });
    expect(agent.tools).toContain('Edit');
    expect(agent.instructions).toContain('Do not commit');
    expect(agent.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('lets the operator library override a built-in agent with the same id', () => {
    const own = library({ 'implementer.md': agentFile('My implementer') });
    const agent = new AgentLibrary([
      { source: 'builtin', path: builtin },
      { source: 'library', path: own },
    ]).get('implementer');
    expect(agent).toMatchObject({ name: 'My implementer', source: 'library', instructions: 'Be careful.' });
  });

  it('changes the version when the file changes', () => {
    const dir = library({ 'a.md': agentFile('A') });
    const lib = new AgentLibrary([{ source: 'library', path: dir }]);
    const before = lib.get('a').version;
    writeFileSync(join(dir, 'agents', 'a.md'), agentFile('A', 'effort: low\n'));
    expect(lib.get('a').version).not.toBe(before);
  });

  it('rejects unknown tools and MCP tools without their server', () => {
    const dir = library({ 'bad.md': '---\nname: Bad\ntools: [Teleport]\n---\nx' });
    expect(() => new AgentLibrary([{ source: 'library', path: dir }]).list()).toThrow('Unknown tool');
    const mcp = library({ 'm.md': '---\nname: M\ntools: [mcp__docs]\n---\nx' });
    expect(() => new AgentLibrary([{ source: 'library', path: mcp }]).list()).toThrow('Unknown tool');
    const ok = library({ 'm.md': '---\nname: M\ntools: [mcp__docs]\nmcpServers:\n  docs: { type: http, url: "https://example.com/mcp" }\n---\nx' });
    expect(new AgentLibrary([{ source: 'library', path: ok }]).get('m').tools).toEqual(['mcp__docs']);
  });

  it('reports a missing agent', () => {
    expect(() => new AgentLibrary([]).get('nope')).toThrow(expect.objectContaining({ code: 'AGENT_NOT_FOUND' }));
  });
});
