import { z } from 'zod';

export const packageManagerSchema = z.enum(['pnpm', 'yarn', 'npm', 'bun']);
export type PackageManager = z.infer<typeof packageManagerSchema>;

/** A deterministic check Megalodon runs itself; its result, not an agent's claim, decides (ADR-0015). */
export const checkSchema = z.object({
  name: z.string().trim().min(1).max(60),
  command: z.string().trim().min(1),
  required: z.boolean(),
  timeoutSec: z.number().int().min(1).max(3600),
});
export type Check = z.infer<typeof checkSchema>;

export const knowledgeSchema = z.object({
  /** `repo`: files committed to the project; `external`: a git repository in the data dir (ADR-0016). */
  location: z.enum(['repo', 'external']),
  /** Relative folder inside the repository when `location` is `repo`. */
  path: z
    .string()
    .trim()
    .min(1)
    .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'Must be a relative path inside the project'),
});
export type Knowledge = z.infer<typeof knowledgeSchema>;

const mode3 = z.enum(['auto', 'auto_if', 'operator']);
const mode2 = z.enum(['auto', 'operator']);

/**
 * One policy per gate (CONCEPTS.md §6, ADR-0028): `auto` passes, `operator` asks you, `auto_if`
 * passes when the gate's conditions hold.
 */
export const policiesSchema = z.object({
  /** After triage. auto_if: triage found no manual tasks. */
  queue: z.object({ mode: mode3 }).default({ mode: 'auto' }),
  /** After the plan step. auto_if: the plan touches no sensitive path. */
  plan: z.object({ mode: mode3 }).default({ mode: 'auto' }),
  /** After a run. auto_if: review approved with at least `minScore` and no sensitive path changed. */
  merge: z.object({ mode: mode3, minScore: z.number().int().min(0).max(10) }).default({ mode: 'auto_if', minScore: 7 }),
  /** In the merge queue. auto: the resolver agent tries `attempts` times. */
  conflicts: z.object({ mode: mode2, attempts: z.number().int().min(1).max(5) }).default({ mode: 'auto', attempts: 2 }),
  /** After a merge: push the base branch to `remote`. */
  push: z.object({ mode: mode2, remote: z.string().trim().min(1) }).default({ mode: 'operator', remote: 'origin' }),
});
export type Policies = z.infer<typeof policiesSchema>;
export const defaultPolicies: Policies = policiesSchema.parse({});

export const projectSettingsSchema = z
  .object({
    /** The branch tasks start from and merge into; `main` unless the project uses another name. */
    baseBranch: z.string().trim().min(1),
    packageManager: packageManagerSchema.nullable(),
    /** Commands run in a fresh worktree before agents start, e.g. a frozen install. */
    setup: z.array(z.string().trim().min(1)),
    checks: z.array(checkSchema),
    maxFixPasses: z.number().int().min(0).max(5),
    /** Glob patterns of areas that never merge without the operator (payments, auth, migrations). */
    sensitivePaths: z.array(z.string().trim().min(1)),
    knowledge: knowledgeSchema,
    /** At most this many runs of the project at once (CONCEPTS.md §5); null: only the global limit. */
    maxParallel: z.number().int().min(1).max(50).nullable().default(null),
    policies: policiesSchema.default(defaultPolicies),
  })
  .refine((s) => new Set(s.checks.map((c) => c.name)).size === s.checks.length, {
    message: 'Check names must be unique',
    path: ['checks'],
  });
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Absolute path of the repository root (the operator's checkout). */
  path: z.string(),
  settings: projectSettingsSchema,
  connectedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const workspaceSchema = z.object({
  activeProjectId: z.string().nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const branchSchema = z.object({
  /** Short name: `feature/x` for local, `origin/feature/x` for remote-tracking branches. */
  name: z.string(),
  kind: z.enum(['local', 'remote']),
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  committedAt: z.string(),
  /** Commits on the branch that the base does not have, and the reverse. */
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  isBase: z.boolean(),
});
export type Branch = z.infer<typeof branchSchema>;

export const diffFileSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'other']),
  /** null for binary files. */
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
});
export type DiffFile = z.infer<typeof diffFileSchema>;

export const branchDiffSchema = z.object({
  base: z.string(),
  ref: z.string(),
  files: z.array(diffFileSchema),
});
export type BranchDiff = z.infer<typeof branchDiffSchema>;

export const filePatchSchema = z.object({
  path: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
});
export type FilePatch = z.infer<typeof filePatchSchema>;

// Request bodies

export const connectProjectBodySchema = z.object({ path: z.string().trim().min(1) });
export const updateSettingsBodySchema = z.object({ settings: projectSettingsSchema });
export const setActiveProjectBodySchema = z.object({ projectId: z.string().nullable() });

// Events (data payloads)

export const projectEvents = {
  connected: 'project.connected',
  settingsChanged: 'project.settings_changed',
  disconnected: 'project.disconnected',
  activeSet: 'workspace.active_project_set',
} as const;

export const projectConnectedSchema = projectSchema.pick({ id: true, name: true, path: true, settings: true });
export const projectSettingsChangedSchema = z.object({ id: z.string(), settings: projectSettingsSchema });
export const projectDisconnectedSchema = z.object({ id: z.string() });
export const activeProjectSetSchema = z.object({ projectId: z.string().nullable() });

export const projectStream = (id: string) => `project:${id}`;
export const WORKSPACE_STREAM = 'workspace';
