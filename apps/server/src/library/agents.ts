import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { agentFrontMatterSchema, type Agent } from '@megalodon/contracts';
import { parse } from 'yaml';
import { AppError } from '../errors';

export interface LibraryDir {
  source: Agent['source'];
  path: string;
}

/**
 * Agent definitions as Markdown files with front matter (ADR-0005). Later directories win on the
 * same id, so the operator's library overrides the built-in one. Files are read on every call:
 * an edit takes effect for the next run, and the run records the version it used.
 */
export class AgentLibrary {
  constructor(private readonly dirs: readonly LibraryDir[]) {}

  list(): Agent[] {
    const byId = new Map<string, Agent>();
    for (const dir of this.dirs) {
      const agentsDir = join(dir.path, 'agents');
      if (!existsSync(agentsDir)) continue;
      for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort()) {
        const agent = parseAgent(join(agentsDir, file), dir.source);
        byId.set(agent.id, agent);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Agent {
    const agent = this.list().find((a) => a.id === id);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', `No agent "${id}"`);
    return agent;
  }
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseAgent(path: string, source: Agent['source']): Agent {
  const content = readFileSync(path, 'utf8');
  const id = basename(path, '.md');
  const match = FRONT_MATTER.exec(content);
  if (!match) throw new AppError(500, 'INVALID_AGENT', `${path}: missing front matter`);
  const result = agentFrontMatterSchema.safeParse(parse(match[1] ?? '') ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(500, 'INVALID_AGENT', `${path}: ${issue?.path.join('.')} ${issue?.message}`);
  }
  return {
    id,
    ...result.data,
    instructions: (match[2] ?? '').trim(),
    source,
    version: createHash('sha256').update(content).digest('hex').slice(0, 12),
  };
}
