---
name: slice-commits
description: >-
  Split a finished working tree into small readable commits. Route each
  slice onto the branch it belongs to: the open branch only when the
  change continues that branch's work, otherwise a new constitution-named
  branch. One working tree often holds several features, so do not put
  every commit on the same branch. Then push each branch. Use when the
  user is done changing files and asks to slice, split, or ship the
  commits, or invokes this skill.
disable-model-invocation: true
---

# Slice commits

The user finished a pile of edits. Do not commit them as one blob. Split them into commits a human can read. Put each commit on the branch that change belongs to, then push those branches.

## Rules

Branch name: `<type>/<issue>-<short-desc>`

- Types: `feat`, `fix`, `hotfix`, `docs`, `refactor`, `chore`
- `<issue>` is the GitHub issue number. Omit it, and the slash before the description, when no issue exists: `feat/add-oauth-refresh`
- `<short-desc>` is kebab-case. The whole name is under 50 characters
- Infer the type from that branch's work. One feature is one branch. A session can produce several branches. Every commit on a branch matches that branch's type. Use scope to tell commits apart

Commit message: `<type>(<scope>): <description>`

- Scope optional
- Imperative, lowercase, no trailing period
- Breaking change: add `BREAKING CHANGE:` in the footer
- The message says why. It is not a file list

Each commit is one change a person can understand in one reading. Each commit changes fewer than 10 files. A 10-file commit is too big. Split it.

Do not create a pull request.

## Steps

1. Inspect the uncommitted work before writing anything.
2. Decide which branch each change belongs on.
3. Plan the commits, oldest first, per branch.
4. Create them.
5. Push each branch once.
6. Report each branch and its commit subjects.

### 1. Inspect

Run `but status`.

- If it prints a GitButler workspace, stay on the GitButler path below. Never run `git add`, `git commit`, `git push`, `git checkout`, or `git switch`.
- If it fails because this is not a GitButler project, use the git path below.

Also run `but diff` on the GitButler path, or `git status` and `git diff` on the git path. Read the diff. Do not commit from filenames alone.

Read what the open branch is for before assigning work to it. On GitButler, `but status` shows applied branches and their commits. On git, read the current branch name and `git log --oneline`. The branch name and the commits already on it are the purpose. The diff is judged against that purpose.

Leave secrets uncommitted (`.env`, credentials, keys) and name them in the report.

If there is nothing to commit, stop.

### 2. Branch

Group the diff by feature first. A feature is one purpose a reviewer would expect on its own branch. Then assign each group a branch.

A group stays on the open branch only when it continues that branch's work: the same feature as the branch name and the commits already on it.

A group that is a different feature, fix, or concern gets its own new branch. An open branch is not a default destination. A session with several features does not get one branch for all of them.

Name every new branch with the rule above. Its type comes from that group's work, not from the open branch.

If you cannot tell whether a group continues the open branch or starts a new one, stop and ask. Do not guess.

A group that only makes sense on top of another group's commits is not an independent branch. Stack it on the branch it needs.

**GitButler.** A branch is open when `but status` shows an applied branch above the uncommitted area. `zz` and the common base are not a branch. A hint to run `but branch new` means no branch is open.

- Matching group, one open branch: commit onto it with `-b <that-branch>`.
- Non-matching group: `-b` a new name. The first `but commit -b` creates it and leaves it off the open branch.
- No open branch: one new branch per feature.
- More than one applied stack: put a group on the stack whose commits it continues. If none fit, create a new branch. If two stacks could both fit, stop and ask.
- Dependent group: after its commits exist, `but move <new-branch> --above <branch-it-needs>`.

**Git.** A branch is open when the current branch is not `main` or `master`.

- Matching group: commit onto the open branch.
- Non-matching group: commit it on a new branch cut from the default branch, not from the open feature branch.
- No open branch: one new branch per feature, each cut from the default branch.
- Dependent group: cut the new branch from the branch it needs.

### 3. Plan

Group the diff into commits before the first commit:

- One purpose per commit
- Each commit already has a branch from step 2
- Fewer than 10 files
- Oldest commit first within a branch, so that branch's history reads in order
- A lockfile travels with the dependency change that caused it
- Do not slice one edit into a broken middle state just to hit the file cap. If one change is 10 or more files, split it into ordered steps that still read in sequence

Omitting file ids on `but commit` commits everything. That is the failure this skill exists to stop.

### 4. Create

**GitButler.** Take file and hunk ids from `but diff`. Copy them exactly. A hunk id is `<file-id>:<hunk-id>`. Pass ids as separate arguments. Chain the commits in one shell call. Within a branch, oldest first. Every call includes `-b <that-commit's-branch>` and `-m`. Different branches use different `-b` values:

```bash
but commit -b <branch-a> -m "<type>(<scope>): <description>" <id> <id> \
&& but commit -b <branch-a> -m "<type>(<scope>): <description>" <id> \
&& but commit -b <branch-b> -m "<type>(<scope>): <description>" <id>
```

The first commit on a branch is the oldest. Later commits on that branch stack on top. Re-read `but diff` only if an id stops resolving.

**Git.** Finish one branch before starting the next. Stage only that commit's files, then commit. Repeat oldest first. Do not `git add -A` unless that commit is the entire remaining diff and it is already under 10 files.

Commit the open branch's groups first. For an independent group, cut a new branch from the default branch while its files are still uncommitted, then commit those. Return to the default branch before cutting the next independent branch.

```bash
git add -- <file> <file>
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

EOF
)"
```

### 5. Push

- GitButler: `but push <branch>` once per branch that received commits. A branch stacked on another is pushed by pushing the top branch once.
- Git: `git push -u origin HEAD` on each branch that received commits.

### 6. Report

- Each branch name, and whether it was the open branch or a new one
- Commit subjects on that branch, oldest first
- Anything left uncommitted, and why
