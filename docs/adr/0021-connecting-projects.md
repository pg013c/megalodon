# ADR-0021: Connecting projects, the base branch and reads of the operator's checkout

Status: Accepted · Date: 2026-10-26

## Context
MVP step 1 connects local repositories. The rules for what can be connected, which branch is the
base, and what Megalodon may do to the operator's checkout before any merge exists need to be fixed.

## Decision
- **What can be connected:** an absolute path (or one starting with `~/`) to the **root** of a git
  repository with at least one commit. A folder inside a repository, a plain folder and an empty
  repository are refused with stable codes (`NOT_REPOSITORY_ROOT`, `NOT_A_REPOSITORY`,
  `NO_COMMITS`). Paths are compared after resolving symlinks; a repository is connected once.
- **Base branch:** detected as `main`, else `master`, else the branch checked out at connect time.
  It is part of the project settings and can be changed to any existing local branch. Documents
  say `main` for this branch.
- **Events:** `project.connected`, `project.settings_changed`, `project.disconnected`, and
  `workspace.active_project_set` for the active project, which is persisted like everything else.
  The first connected project becomes active. Disconnecting the active project clears it.
- **The operator's checkout:** besides the merge (ADR-0014), Megalodon only reads it (`for-each-ref`,
  `rev-list`, `diff`) and, on the operator's click, runs `git fetch --all --prune`, which updates
  remote-tracking refs and never the working tree. Git runs without a shell, with
  `GIT_TERMINAL_PROMPT=0`, so a missing credential fails instead of hanging.
- **Branch names from the UI** are resolved only as `refs/heads/<name>` or `refs/remotes/<name>`;
  anything starting with `-` is refused. Diffs use `<base>...<branch>`, i.e. the changes the branch
  made since it left the base.

## Consequences
- Connecting a project writes nothing into it (tested).
- Projects whose base is not `main` work without renaming branches.
