import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import {
  projectEvents,
  projectSettingsSchema,
  projectStream,
  WORKSPACE_STREAM,
  type Actor,
  type Branch,
  type BranchDiff,
  type FilePatch,
  type Project,
  type ProjectSettings,
} from '@megalodon/contracts';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import * as repo from '../git/repo';
import { detectSettings } from './detect';
import type { ProjectsQueries } from './projection';

const OPERATOR: Actor = { kind: 'operator' };

/** Commands and git reads for connected projects. Reads of the operator's checkout never write to it. */
export class ProjectService {
  constructor(
    private readonly store: EventStore,
    readonly queries: ProjectsQueries,
  ) {}

  list(): Project[] {
    return this.queries.list();
  }

  get(id: string): Project {
    const project = this.queries.get(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', `No project ${id}`);
    return project;
  }

  /** Connects the repository whose root is `inputPath` (ADR-0021). */
  async connect(inputPath: string): Promise<Project> {
    const path = resolveInputPath(inputPath);
    if (!isDirectory(path)) throw new AppError(400, 'NOT_A_DIRECTORY', `${path} is not a directory`);
    const real = realpathSync(path);

    const root = await repo.repoRoot(real);
    if (!root) throw new AppError(400, 'NOT_A_REPOSITORY', `${real} is not a git repository`);
    if (realpathSync(root) !== real) {
      throw new AppError(400, 'NOT_REPOSITORY_ROOT', `${real} is inside the repository ${root}; connect its root`);
    }
    if (!(await repo.hasCommits(real))) {
      throw new AppError(400, 'NO_COMMITS', `${real} has no commits yet; make the first commit and connect again`);
    }
    if (this.queries.byPath(real)) throw new AppError(409, 'ALREADY_CONNECTED', `${real} is already connected`);

    const id = randomUUID();
    const settings = detectSettings(real, await repo.detectBaseBranch(real));
    this.store.append([
      {
        type: projectEvents.connected,
        stream: projectStream(id),
        data: { id, name: basename(real), path: real, settings },
        actor: OPERATOR,
      },
    ]);
    // the first connected project becomes active, so the UI has a context right away
    if (this.queries.activeProjectId() === null) this.setActive(id);
    return this.get(id);
  }

  async updateSettings(id: string, input: ProjectSettings): Promise<Project> {
    const project = this.get(id);
    const settings = projectSettingsSchema.parse(input);
    if (!(await repo.localBranchExists(project.path, settings.baseBranch))) {
      throw new AppError(400, 'BASE_BRANCH_NOT_FOUND', `Branch "${settings.baseBranch}" does not exist in ${project.name}`);
    }
    this.store.append([
      { type: projectEvents.settingsChanged, stream: projectStream(id), data: { id, settings }, actor: OPERATOR },
    ]);
    return this.get(id);
  }

  disconnect(id: string): void {
    this.get(id);
    this.store.append([{ type: projectEvents.disconnected, stream: projectStream(id), data: { id }, actor: OPERATOR }]);
  }

  activeProjectId(): string | null {
    return this.queries.activeProjectId();
  }

  setActive(projectId: string | null): void {
    if (projectId !== null) this.get(projectId);
    if (projectId === this.queries.activeProjectId()) return;
    this.store.append([{ type: projectEvents.activeSet, stream: WORKSPACE_STREAM, data: { projectId }, actor: OPERATOR }]);
  }

  async branches(id: string): Promise<Branch[]> {
    const { path, settings } = this.get(id);
    return repo.listBranches(path, settings.baseBranch);
  }

  async fetch(id: string): Promise<Branch[]> {
    await repo.fetchAll(this.get(id).path);
    return this.branches(id);
  }

  async diff(id: string, branch: string): Promise<BranchDiff> {
    const { path, settings } = this.get(id);
    return repo.diffFiles(path, settings.baseBranch, branch);
  }

  async filePatch(id: string, branch: string, file: string): Promise<FilePatch> {
    const { path, settings } = this.get(id);
    return repo.filePatch(path, settings.baseBranch, branch, file);
  }
}

function resolveInputPath(input: string): string {
  const expanded = input === '~' ? homedir() : input.startsWith('~/') ? join(homedir(), input.slice(2)) : input;
  if (!isAbsolute(expanded)) throw new AppError(400, 'PATH_NOT_ABSOLUTE', 'Give an absolute path or one starting with ~/');
  return expanded;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
