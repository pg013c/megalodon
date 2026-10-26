import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { useTempDir } from '../test/tempDir';
import { Library } from './library';

const tempDir = useTempDir();
const builtin = fileURLToPath(new URL('../../../../library', import.meta.url));

function library(files: Record<string, string>) {
  const dir = tempDir();
  mkdirSync(join(dir, 'agents'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'agents', name), content);
  return dir;
}

const agentFile = (name: string, extra = '') => `---\nname: ${name}\ntools: [Read, Edit]\n${extra}---\nBe careful.\n`;

describe('Library: agents', () => {
  it('loads the built-in implementer', () => {
    const agent = new Library([{ source: 'builtin', path: builtin }]).agent('implementer');
    expect(agent).toMatchObject({ name: 'Implementer', model: 'claude-opus-5-5', source: 'builtin' });
    expect(agent.tools).toContain('Edit');
    expect(agent.instructions).toContain('Do not commit');
    expect(agent.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('lets the operator library override a built-in agent with the same id', () => {
    const own = library({ 'implementer.md': agentFile('My implementer') });
    const agent = new Library([
      { source: 'builtin', path: builtin },
      { source: 'library', path: own },
    ]).agent('implementer');
    expect(agent).toMatchObject({ name: 'My implementer', source: 'library', instructions: 'Be careful.' });
  });

  it('changes the version when the file changes', () => {
    const dir = library({ 'a.md': agentFile('A') });
    const lib = new Library([{ source: 'library', path: dir }]);
    const before = lib.agent('a').version;
    writeFileSync(join(dir, 'agents', 'a.md'), agentFile('A', 'effort: low\n'));
    expect(lib.agent('a').version).not.toBe(before);
  });

  it('rejects unknown tools and MCP tools without their server', () => {
    const dir = library({ 'bad.md': '---\nname: Bad\ntools: [Teleport]\n---\nx' });
    expect(() => new Library([{ source: 'library', path: dir }]).agents()).toThrow('Unknown tool');
    const mcp = library({ 'm.md': '---\nname: M\ntools: [mcp__docs]\n---\nx' });
    expect(() => new Library([{ source: 'library', path: mcp }]).agents()).toThrow('Unknown tool');
    const ok = library({ 'm.md': '---\nname: M\ntools: [mcp__docs]\nmcpServers:\n  docs: { type: http, url: "https://example.com/mcp" }\n---\nx' });
    expect(new Library([{ source: 'library', path: ok }]).agent('m').tools).toEqual(['mcp__docs']);
  });

  it('reports a missing agent', () => {
    expect(() => new Library([]).agent('nope')).toThrow(expect.objectContaining({ code: 'AGENT_NOT_FOUND' }));
  });
});

const pipelineFile = (steps: string) => `name: P\nsteps:\n${steps}`;

function pipelines(files: Record<string, string>) {
  const dir = tempDir();
  mkdirSync(join(dir, 'pipelines'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'pipelines', name), content);
  return dir;
}

describe('Library: pipelines', () => {
  it('loads the built-in feature pipeline with its agents', () => {
    const lib = new Library([{ source: 'builtin', path: builtin }]);
    const feature = lib.pipeline('feature');
    expect(feature.steps.map((s) => s.id)).toEqual(['plan', 'implement', 'checks', 'review']);
    expect(feature.steps[3]).toMatchObject({ agent: 'reviewer', gate: { minScore: 7 }, onFail: { retry: 'implement', max: 1 } });
    expect(feature.steps[2]).toMatchObject({ check: 'project', onFail: { retry: 'implement', max: 'project' } });
    expect(lib.agent('reviewer').output).toBe('review');
    expect(lib.agent('planner').output).toBe('plan');
  });

  it('rejects a retry of a later or unknown step, and duplicate ids', () => {
    const later = pipelines({ 'p.yaml': pipelineFile('  - { id: a, check: project, onFail: { retry: b } }\n  - { id: b, agent: x }\n') });
    expect(() => new Library([{ source: 'library', path: later }]).pipelines()).toThrow('not an earlier step');
    const dup = pipelines({ 'p.yaml': pipelineFile('  - { id: a, agent: x }\n  - { id: a, agent: y }\n') });
    expect(() => new Library([{ source: 'library', path: dup }]).pipelines()).toThrow('Duplicate step');
  });

  it('refuses a pipeline whose agent does not exist', () => {
    const dir = pipelines({ 'p.yaml': pipelineFile('  - { id: a, agent: ghost }\n') });
    expect(() => new Library([{ source: 'library', path: dir }]).pipeline('p')).toThrow(expect.objectContaining({ code: 'AGENT_NOT_FOUND' }));
  });
});
