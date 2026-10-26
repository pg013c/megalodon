import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { agentFrontMatterSchema, type Agent } from '@megalodon/contracts';
import { parse } from 'yaml';
import { AppError } from '../errors';
import { contentVersion } from './library';

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
    version: contentVersion(content),
  };
}
