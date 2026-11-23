# ADR-0033: Project commit conventions

Status: Accepted · Date: 2026-11-24 · Builds on ADR-0024, ADR-0027 · Supersedes the commit
message of ADR-0024 and the merge message of ADR-0027

## Context
After each agent step Megalodon commits the worktree itself (ADR-0024): `#<n> <title>` (or
`#<n> <step>: fixes (attempt <k>)`) with the agent's chat reply as the body, and `--no-verify`.
Merges are `Merge #<n> <title>` (ADR-0027). On offline-assistant #1 the reviewer blocked a correct
change because the branch history broke that project's rules. Projects with commit rules
(Conventional Commits, required trailers, commit hooks, CI that checks subjects) cannot accept such
branches.

## Decision
- **Setting.** `ProjectSettings.commits = { style: 'megalodon' | 'conventional', trailers: string[],
  hooks: boolean }`, default `{ style: 'megalodon', trailers: [], hooks: false }`. Settings stored
  before the field existed parse to the default, so existing projects commit exactly as before and
  no migration is needed. A trailer must look like `Token: value`.
- **Megalodon style** keeps today's subjects and body; configured trailers are appended.
- **Conventional style.**
  - Agent steps whose agent has no output contract of its own (the implementer) are asked for the
    `commit` output contract: `{ summary, commit: { subject, body, trailers } }`. The contract is
    chosen per project at run time, not in the agent file, so the agent's version (its content
    hash) stays the same and default projects keep running it without structured output. The
    prompt says the project follows Conventional Commits and that Megalodon commits the work.
  - The subject must match `type(scope)!: summary` with a @commitlint/config-conventional type
    (`feat fix docs style refactor perf test build ci chore revert`), on one line of at most 100
    characters. Otherwise, and when the answer has no valid commit message at all, the subject is
    `chore: #<n> <title>` clipped to 100 characters. A missing or invalid commit message never fails
    the step.
  - The body is the agent's `body` only. The chat reply never becomes the body.
  - Trailers: the agent's trailers that look like `Token: value`, then the configured ones, without
    exact duplicates.
  - The commit output is not stored as the step's `output`: the message is in git, and the step's
    `output` keeps meaning "answered an agent contract", which the scorecard uses to credit review
    scores to the implementer (ADR-0032). When the reply text is empty the step's `result` is the
    answer's `summary`.
- **Hooks.** With `hooks: true` run commits drop `--no-verify`. The commit runs with the agents'
  environment (`agentEnv`, ADR-0010): hooks are project code, like checks. It has a 15-minute
  timeout, because pre-commit hooks may run linters or tests. A failing commit marks the agent step
  `failed` (`The commit hooks failed`) and retries the same step with git's output as feedback,
  continuing the agent's session, up to `maxFixPasses`, like failing checks. The retry is a `retry`
  decision on that step, so it counts in the step's retries, as a failed attempt and as rework.
- **When the commit happens.** The commit moved from the run loop into the agent step: after the
  answer is validated and before the step is recorded `succeeded`, so a failing hook can still fail
  the step. Plan approval and the reviewer's verdict follow the commit as before.
- **Merge commits.** `Merge #<n> <title>` and `Merge <base> into <branch>` keep that form under the
  Megalodon style. Under the conventional style they become `merge: #<n> <title>` and
  `merge: <base> into <branch>`.
- Conflict-resolution commits (`concludeMerge`) keep `--no-verify`: the resolver's commit concludes
  a merge whose checks run right after. The merge in the operator's checkout keeps git's default
  hook behaviour. Both are unchanged.

## Consequences
- `merge` is not a @commitlint/config-conventional type. Projects with strict commitlint may still
  reject merge commits; the settings screen says so.
- With hooks on, any failure of `git commit` (a missing identity, gpg signing) is treated as a hook
  failure and retried up to `maxFixPasses`. The feedback shows git's output, so the cause is
  visible, but the agent cannot fix it.
- A step with its own `onFail` (the review step) shares its retry counter with hook failures on that
  step. Hook failures raise failed attempts and rework in the scorecard; that is intended.
- Husky-style hooks need the project's dependencies, which its `setup` usually installs.
- Under the conventional style the implementer's SDK call uses structured output; its reply text may
  be shorter, the summary moves into the answer.
