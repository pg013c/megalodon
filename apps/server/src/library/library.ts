import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipelineFileSchema, type Agent, type Pipeline } from '@megalodon/contracts';
import { parse } from 'yaml';
import { AppError } from '../errors';
import { parseAgent } from './agents';

export interface LibraryDir {
  source: Agent['source'];
  path: string;
}

/**
 * Agents (`agents/*.md`) and pipelines (`pipelines/*.yaml`) from the built-in library and the
 * operator's (ADR-0005). Later directories win on the same id. Files are read on every call, so an
 * edit takes effect for the next run, which records the version it used.
 */
export class Library {
  constructor(private readonly dirs: readonly LibraryDir[]) {}

  agents(): Agent[] {
    return this.collect('agents', '.md', parseAgent).sort((a, b) => a.name.localeCompare(b.name));
  }

  agent(id: string): Agent {
    const agent = this.agents().find((a) => a.id === id);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', `No agent "${id}"`);
    return agent;
  }

  pipelines(): Pipeline[] {
    return this.collect('pipelines', '.yaml', parsePipeline).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A pipeline whose agents all exist. */
  pipeline(id: string): Pipeline {
    const pipeline = this.pipelines().find((p) => p.id === id);
    if (!pipeline) throw new AppError(404, 'PIPELINE_NOT_FOUND', `No pipeline "${id}"`);
    for (const step of pipeline.steps) if ('agent' in step) this.agent(step.agent);
    return pipeline;
  }

  private collect<T extends { id: string }>(folder: string, extension: string, parseFile: (path: string, source: Agent['source']) => T): T[] {
    const byId = new Map<string, T>();
    for (const dir of this.dirs) {
      const path = join(dir.path, folder);
      if (!existsSync(path)) continue;
      for (const file of readdirSync(path).filter((f) => f.endsWith(extension)).sort()) {
        const item = parseFile(join(path, file), dir.source);
        byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }
}

export function parsePipeline(path: string, source: Agent['source']): Pipeline {
  const content = readFileSync(path, 'utf8');
  const result = pipelineFileSchema.safeParse(parse(content) ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(500, 'INVALID_PIPELINE', `${path}: ${issue?.path.join('.')} ${issue?.message}`);
  }
  return { id: basename(path, '.yaml'), ...result.data, source, version: contentVersion(content) };
}

export const contentVersion = (content: string) => createHash('sha256').update(content).digest('hex').slice(0, 12);
